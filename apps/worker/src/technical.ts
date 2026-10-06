import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "node:tls";
import { resolveMx } from "node:dns/promises";
import { chromium } from "playwright";
import type { TechnicalResults } from "@quickscan/contracts";
import { assertPublicWebUrl } from "@quickscan/site-policy";
import { blockUnsafeRequests } from "./capture.js";

export async function runTechnicalChecks(scanId: string, url: string, artifactsPath: string, activeChecks: boolean, formSubmissionTesting: boolean = false): Promise<TechnicalResults> {
  const response = await publicFetch(url);
  const headers = response.headers;
  const bodyText = await response.text();
  const generator = bodyText.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
  const hostname = new URL(url).hostname;
  const sslDays = await certificateDays(hostname);
  const http = new URL(url);
  http.protocol = "http:";
  const httpResponse = await publicFetch(http.toString()).catch(() => undefined);
  const redirects = httpResponse?.url.startsWith("https:") ?? false;
  const missingHeaders = [
    !headers.get("strict-transport-security") && "HSTS",
    !headers.get("x-frame-options") && !headers.get("content-security-policy")?.includes("frame-ancestors") && "X-Frame-Options/CSP",
    headers.get("x-content-type-options")?.toLowerCase() !== "nosniff" && "X-Content-Type-Options",
  ].filter(Boolean);
  
  // Try to run browser checks with fallback for partial failure
  let browserChecks;
  let browserChecksAvailable = true;
  try {
    browserChecks = await runBrowserChecks(scanId, url, artifactsPath);
  } catch (error) {
    browserChecksAvailable = false;
    // Browser checks failed - provide unavailable fallback metrics
    console.warn('Browser checks failed, using fallback unavailable results');
    browserChecks = {
      mobile: { viewport: false, horizontalOverflow: false, smallTargets: 0, obscuredTargets: 0, totalTargets: 0 },
      accessibility: { language: false, missingAlt: 0, unlabeledFields: 0, totalImages: 0, totalFields: 0 },
      seo: { titleLength: 0, descriptionLength: 0, h1: false, canonical: false, skippedHeadings: 0 },
      indexability: { noindex: false },
      structuredData: false,
      socialMetadata: { openGraph: false, xCard: false },
      checkedLinks: 0,
      brokenLinks: 0,
      brokenImages: 0,
      checkedImages: 0,
    };
  }
  
  const exposure = activeChecks ? await checkExposure(url) : unavailable("Niet uitgevoerd zonder expliciete toestemming.");
  const indexability = browserChecksAvailable
    ? await checkIndexability(url, headers, browserChecks.indexability)
    : unavailable("Browsercontrole niet beschikbaar.");
  const { clsScore, ...pageSpeedResult } = await pageSpeed(url);
  const sslChain = await validateSslChain(hostname);
  const dnsSafety = await checkDnsSafety(hostname);
  const formSubmission = formSubmissionTesting ? await testFormSubmission(url, artifactsPath, scanId) : unavailable("Formuliertesten niet ingeschakeld.");

  return {
    https: graded([sslDays >= 14 ? 1 : 0, redirects ? 1 : 0], sslDays >= 14 && redirects, `Certificaat: ${sslDays} dagen; HTTP-redirect: ${redirects ? "actief" : "ontbreekt"}.`, sslDays < 0 ? "fail" : "warning"),
    mobile: browserChecksAvailable ? assessMobile(browserChecks.mobile) : unavailable("Browsercontrole niet beschikbaar."),
    pagespeed: pageSpeedResult,
    cls: assessCls(clsScore),
    ssl_chain: sslChain,
    dns_safety: dnsSafety,
    form_submission: formSubmission,
    links_media: browserChecksAvailable ? assessLinksMedia(browserChecks) : unavailable("Browsercontrole niet beschikbaar."),
    accessibility: browserChecksAvailable ? assessAccessibility(browserChecks.accessibility) : unavailable("Browsercontrole niet beschikbaar."),
    seo_basics: browserChecksAvailable ? assessSeo(browserChecks.seo) : unavailable("Browsercontrole niet beschikbaar."),
    indexability,
    structured_data: browserChecksAvailable ? check(browserChecks.structuredData, browserChecks.structuredData ? "Structured data is gevonden." : "Geen structured data gevonden.") : unavailable("Browsercontrole niet beschikbaar."),
    social_metadata: browserChecksAvailable ? assessSocialMetadata(browserChecks.socialMetadata) : unavailable("Browsercontrole niet beschikbaar."),
    security_headers: assessSecurityHeaders(missingHeaders.length, missingHeaders.length ? `Ontbreekt: ${missingHeaders.join(", ")}.` : "Essentiele headers zijn aanwezig."),
    cms_version: generator ? check(!/wordpress|joomla/i.test(generator), `Openbare generator: ${generator}.`) : unavailable("Geen openbare CMS-versie gevonden."),
    exposure,
  };
}

type MobileMetrics = { viewport: boolean; horizontalOverflow: boolean; smallTargets: number; obscuredTargets: number; totalTargets: number };
type AccessibilityMetrics = { language: boolean; missingAlt: number; unlabeledFields: number; totalImages: number; totalFields: number };
type SeoMetrics = { titleLength: number; descriptionLength: number; h1: boolean; canonical: boolean; skippedHeadings: number };
type IndexabilityMetrics = { noindex: boolean };
type SocialMetadataMetrics = { openGraph: boolean; xCard: boolean };

export function assessCls(score: number | undefined) {
  return score !== undefined && Number.isFinite(score)
    ? graded([score <= 0.1 ? 1 : score <= 0.25 ? 1 - (score - 0.1) / 0.15 * 0.5 : Math.max(0, 0.5 - (score - 0.25) / 0.25 * 0.5)], score <= 0.1, `CLS: ${score.toFixed(3)}; goed: <= 0.1; matig: <= 0.25; slecht: > 0.25.`, score > 0.25 ? "fail" : "warning")
    : unavailable("CLS niet beschikbaar via PageSpeed API.");
}

export function assessMobile(metrics: MobileMetrics) {
  const passed = metrics.viewport && !metrics.horizontalOverflow && metrics.smallTargets === 0 && metrics.obscuredTargets === 0;
  const issues = [
    !metrics.viewport && "viewport-meta ontbreekt",
    metrics.horizontalOverflow && "horizontale scroll",
    metrics.smallTargets > 0 && `${metrics.smallTargets} targets kleiner dan 48px`,
    metrics.obscuredTargets > 0 && `${metrics.obscuredTargets} bedekte targets`,
  ].filter(Boolean);
  return graded([Number(metrics.viewport), Number(!metrics.horizontalOverflow), healthyRatio(metrics.smallTargets, metrics.totalTargets), healthyRatio(metrics.obscuredTargets, metrics.totalTargets)], passed, `${passed ? "Viewport en mobiele touch-targets zijn in orde." : `Aandacht: ${issues.join("; ")}.`} ${metrics.totalTargets} touch-targets gecontroleerd.`);
}

export function assessAccessibility(metrics: AccessibilityMetrics) {
  const issues = [
    !metrics.language && "paginataal ontbreekt",
    metrics.missingAlt > 0 && `${metrics.missingAlt} afbeeldingen zonder alt-tekst`,
    metrics.unlabeledFields > 0 && `${metrics.unlabeledFields} formuliervelden zonder label`,
  ].filter(Boolean);
  const labels = healthyRatio(metrics.unlabeledFields, metrics.totalFields);
  return graded([Number(metrics.language), healthyRatio(metrics.missingAlt, metrics.totalImages), labels, labels], issues.length === 0, `${issues.length === 0 ? "Paginataal, alt-teksten en formulierlabels zijn aanwezig." : `Aandacht: ${issues.join("; ")}.`} ${metrics.totalImages} afbeeldingen en ${metrics.totalFields} velden gecontroleerd; formulierlabels wegen dubbel.`);
}

export function assessSeo(metrics: SeoMetrics) {
  const issues = [
    metrics.titleLength < 1 && "paginatitel ontbreekt",
    metrics.titleLength > 0 && (metrics.titleLength < 30 || metrics.titleLength > 60) && `paginatitel heeft ${metrics.titleLength} tekens (richtlijn 30-60)`,
    metrics.descriptionLength < 1 && "metabeschrijving ontbreekt",
    metrics.descriptionLength > 0 && (metrics.descriptionLength < 70 || metrics.descriptionLength > 160) && `metabeschrijving heeft ${metrics.descriptionLength} tekens (richtlijn 70-160)`,
    !metrics.h1 && "hoofdkop ontbreekt",
    !metrics.canonical && "canonical URL ontbreekt",
    metrics.skippedHeadings > 0 && `${metrics.skippedHeadings} overgeslagen kopniveau${metrics.skippedHeadings === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return graded([metrics.titleLength === 0 ? 0 : metrics.titleLength >= 30 && metrics.titleLength <= 60 ? 1 : 0.6, metrics.descriptionLength === 0 ? 0 : metrics.descriptionLength >= 70 && metrics.descriptionLength <= 160 ? 1 : 0.6, Number(metrics.h1), Number(metrics.canonical), metrics.skippedHeadings === 0 ? 1 : 0], issues.length === 0, issues.length === 0 ? "Titel, metabeschrijving, canonical URL en koppenstructuur zijn in orde." : `Aandacht: ${issues.join("; ")}.`);
}

export function assessSocialMetadata(metrics: SocialMetadataMetrics) {
  const issues = [!metrics.openGraph && "Open Graph-tags ontbreken", !metrics.xCard && "X Card-tags ontbreken"].filter(Boolean);
  return graded([Number(metrics.openGraph), Number(metrics.xCard)], issues.length === 0, issues.length === 0 ? "Open Graph- en X Card-tags zijn aanwezig." : `Aandacht: ${issues.join("; ")}.`);
}

export function assessSecurityHeaders(missing: number, detail: string) {
  return graded([(3 - missing) / 3], missing === 0, detail);
}

export function assessLinksMedia(metrics: { checkedLinks: number; brokenLinks: number; checkedImages: number; brokenImages: number }) {
  return graded([healthyRatio(metrics.brokenLinks, metrics.checkedLinks), healthyRatio(metrics.brokenImages, metrics.checkedImages)], metrics.brokenLinks === 0 && metrics.brokenImages === 0, `${metrics.checkedLinks} interne links gecontroleerd; ${metrics.brokenLinks} kapot. ${metrics.checkedImages} afbeeldingen gecontroleerd; ${metrics.brokenImages} kapot.`);
}

async function runBrowserChecks(scanId: string, url: string, artifactsPath: string): Promise<{ mobile: MobileMetrics; accessibility: AccessibilityMetrics; seo: SeoMetrics; indexability: IndexabilityMetrics; structuredData: boolean; socialMetadata: SocialMetadataMetrics; checkedLinks: number; brokenLinks: number; brokenImages: number; checkedImages: number }> {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  try {
    await blockUnsafeRequests(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    const pageMetrics = await page.evaluate(() => {
      const targets = [...document.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea')]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      return {
        mobile: {
          totalTargets: targets.length,
          viewport: /(?:^|,)\s*width\s*=\s*device-width/i.test(document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? ""),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          smallTargets: targets.filter(({ rect }) => rect.width < 48 || rect.height < 48).length,
          obscuredTargets: targets.filter(({ element, rect }) => {
            const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return top && !element.contains(top) && !top.contains(element);
          }).length,
        },
        accessibility: {
          totalImages: document.images.length,
          totalFields: document.querySelectorAll('input:not([type="hidden"]), select, textarea').length,
          language: Boolean(document.documentElement.lang),
          missingAlt: [...document.images].filter((image) => !image.hasAttribute("alt")).length,
          unlabeledFields: [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="hidden"]), select, textarea')].filter((field) => !field.labels?.length && !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby")).length,
        },
        seo: {
          titleLength: document.title.trim().length,
          descriptionLength: document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim().length ?? 0,
          h1: Boolean(document.querySelector("h1")?.textContent?.trim()),
          canonical: Boolean(document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim()),
          skippedHeadings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].reduce((skips, heading, index, headings) => {
            if (index === 0) return skips;
            return skips + (Number(heading.tagName[1]) > Number(headings[index - 1].tagName[1]) + 1 ? 1 : 0);
          }, 0),
        },
        indexability: { noindex: /noindex/i.test(document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "") },
        structuredData: Boolean(document.querySelector('script[type="application/ld+json"], [itemscope][itemtype*="schema.org"]')),
        socialMetadata: {
          openGraph: Boolean(document.querySelector('meta[property="og:title"], meta[property="og:description"], meta[property="og:image"]')),
          xCard: Boolean(document.querySelector('meta[name="twitter:card"]')),
        },
      };
    });
    const scan = await scanUrls(page, url, scanId, artifactsPath);
    let brokenLinks = 0;
    for (const link of scan.urls) {
      if (await isBrokenLink(link)) brokenLinks += 1;
    }
    return { ...pageMetrics, checkedLinks: scan.urls.length, brokenLinks, brokenImages: scan.brokenImages, checkedImages: scan.checkedImages };
  } finally {
    await browser.close();
  }
}

async function scanUrls(page: import("playwright").Page, homeUrl: string, scanId: string, artifactsPath: string): Promise<{ urls: string[]; brokenImages: number; checkedImages: number }> {
  const selected = await readFile(join(artifactsPath, scanId, "selected-pages.json"), "utf8").catch(() => "[]");
  const knownPages = [homeUrl, ...((JSON.parse(selected) as Array<{ finalUrl?: string; url?: string }>).map((item) => item.finalUrl ?? item.url).filter(Boolean) as string[])];
  const host = new URL(homeUrl).hostname;
  const links = new Set<string>();
  let brokenImages = 0;
  let checkedImages = 0;
  for (const pageUrl of knownPages) {
    if (page.url() !== pageUrl) {
      const loaded = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      if (!loaded) continue;
    }
    const images = await page.locator("img").evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).complete).map((image) => {
      const imageElement = image as HTMLImageElement;
      return imageElement.naturalWidth === 0;
    }));
    checkedImages += images.length;
    brokenImages += images.filter(Boolean).length;
    const hrefs = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const link = new URL(href);
      link.hash = "";
      if (links.size < 20 && link.hostname === host && /^https?:$/.test(link.protocol)) links.add(link.toString());
    }
  }
  return { urls: [...links], brokenImages, checkedImages };
}

async function isBrokenLink(url: string): Promise<boolean> {
  let response = await publicFetch(url, "HEAD").catch(() => undefined);
  if (response?.status === 403 || response?.status === 405) response = await publicFetch(url).catch(() => undefined);
  return !response || response.status >= 400;
}

async function checkIndexability(url: string, headers: Headers, metrics: IndexabilityMetrics) {
  const robots = await publicFetch(new URL("/robots.txt", url).toString()).catch(() => undefined);
  const sitemap = await publicFetch(new URL("/sitemap.xml", url).toString()).catch(() => undefined);
  const issues = [
    !robots?.ok && "robots.txt ontbreekt",
    !sitemap?.ok && "sitemap.xml ontbreekt",
    metrics.noindex && "noindex-meta gevonden",
    /noindex/i.test(headers.get("x-robots-tag") ?? "") && "X-Robots-Tag noindex gevonden",
  ].filter(Boolean);
  const blocked = metrics.noindex || /noindex/i.test(headers.get("x-robots-tag") ?? "");
  return blocked
    ? { status: "fail" as const, score: 0, detail: `Indexering geblokkeerd: ${issues.join("; ")}.` }
    : graded([1, 1, Number(Boolean(robots?.ok)), Number(Boolean(sitemap?.ok))], issues.length === 0, issues.length === 0 ? "robots.txt en sitemap.xml zijn bereikbaar; indexering is niet geblokkeerd." : `Aandacht: ${issues.join("; ")}.`);
}

type ExposureProbe = { path: string; label: string; matches: (body: string) => boolean };

const exposureProbes: ExposureProbe[] = [
  { path: "/.env", label: ".env", matches: (body) => /(?:^|\n)\s*(?:[A-Z][A-Z0-9_]*?(?:KEY|SECRET|TOKEN|PASSWORD)|DB_[A-Z0-9_]+)\s*=/m.test(body) },
  { path: "/.git/HEAD", label: ".git/HEAD", matches: (body) => /^ref:\s+refs\//m.test(body) },
  { path: "/wp-config.php.bak", label: "wp-config.php.bak", matches: (body) => /(?:DB_(?:NAME|USER|PASSWORD|HOST)|\$table_prefix|<\?php)/i.test(body) },
];

async function checkExposure(url: string) {
  const exposed: string[] = [];
  for (const probe of exposureProbes) {
    const response = await publicFetch(new URL(probe.path, url).toString()).catch(() => undefined);
    if (!response?.ok) continue;
    const body = await response.text().catch(() => "");
    if (isExposureContent(probe.path, body)) exposed.push(probe.label);
  }
  return exposed.length === 0
    ? check(true, `${exposureProbes.length} gevoelige endpoints gecontroleerd; niets blootgesteld.`)
    : { status: "fail" as const, detail: `Publiek toegankelijk: ${exposed.join(", ")}.`, score: 0, scoreType: "binary" as const };
}

export function isExposureContent(path: string, body: string): boolean {
  return exposureProbes.find((probe) => probe.path === path)?.matches(body) ?? false;
}

function check(passed: boolean, detail: string) {
  return { status: passed ? "pass" as const : "warning" as const, detail, score: passed ? 5 : 0, scoreType: "binary" as const };
}

function healthyRatio(errors: number, total: number): number | undefined {
  return total > 0 ? Math.max(0, 1 - errors / total) : undefined;
}

function graded(parts: Array<number | undefined>, passed: boolean, detail: string, failureStatus: "warning" | "fail" = "warning") {
  const available = parts.filter((part): part is number => part !== undefined);
  if (!available.length) return unavailable("Geen toepasbare metingen. " + detail);
  return { status: passed ? "pass" as const : failureStatus, detail, score: Math.round(available.reduce((sum, part) => sum + part, 0) / available.length * 50) / 10 };
}

function unavailable(detail: string) {
  return { status: "unavailable" as const, detail, score: 0 };
}

async function publicFetch(value: string, method = "GET"): Promise<Response> {
  let url = await assertPublicWebUrl(value);
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const response = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "user-agent": process.env.SCAN_USER_AGENT ?? "ScoutingWebsiteQuickScan/0.1" } });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return response;
    url = await assertPublicWebUrl(new URL(location, url).toString());
  }
  throw new Error("Te veel redirects.");
}

async function certificateDays(hostname: string): Promise<number> {
  return new Promise((resolve) => {
    const socket = connect(443, hostname, { servername: hostname, rejectUnauthorized: true }, () => {
      const expires = new Date(socket.getPeerCertificate().valid_to).getTime();
      socket.end();
      resolve(Math.floor((expires - Date.now()) / 86_400_000));
    });
    socket.setTimeout(8_000, () => { socket.destroy(); resolve(-1); });
    socket.on("error", () => resolve(-1));
  });
}

export async function pageSpeed(url: string): Promise<{ status: "pass" | "warning" | "fail" | "unavailable"; detail: string; score: number; clsScore?: number }> {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key) return unavailable("Google PageSpeed API-sleutel ontbreekt.");
  try {
    const response = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&url=${encodeURIComponent(url)}&key=${key}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as { lighthouseResult?: { categories?: { performance?: { score?: number } }; audits?: Record<string, { numericValue?: number }> } };
    const performance = result.lighthouseResult?.categories?.performance?.score;
    if (performance === undefined || !Number.isFinite(performance) || performance < 0 || performance > 1) return unavailable("Lighthouse-prestatiescore ontbreekt of is ongeldig.");
    const score = Math.round(performance * 100);
    const audits = result.lighthouseResult?.audits ?? {};
    const fcp = audits["first-contentful-paint"]?.numericValue;
    const lcp = audits["largest-contentful-paint"]?.numericValue;
    const clsScore = audits["cumulative-layout-shift"]?.numericValue;
    const result1 = graded([performance], performance >= 0.9, `Lighthouse mobiel: ${score}/100; FCP: ${fcp === undefined ? "niet beschikbaar" : `${Math.round(fcp / 100) / 10}s`}; LCP: ${lcp === undefined ? "niet beschikbaar" : `${Math.round(lcp / 100) / 10}s`}.`, performance < 0.5 ? "fail" : "warning");
    return { ...result1, clsScore };
  } catch (error) {
    return unavailable(`PageSpeed niet beschikbaar: ${error instanceof Error ? error.message : "onbekende fout"}`);
  }
}

async function validateSslChain(hostname: string) {
  try {
    const issues: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const socket = connect(443, hostname, { servername: hostname, rejectUnauthorized: true }, () => {
        const cert = socket.getPeerCertificate(false);
        if (!cert) { reject(new Error("Geen certificaat gevonden")); return; }
        
        // Check for self-signed
        if (cert.issuer.CN === cert.subject.CN) {
          issues.push("Self-signed certificaat");
        }
        
        // Check expiration warning (30 days)
        const expiresIn = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
        if (expiresIn < 30) {
          issues.push(`Certificaat verloopt in ${expiresIn} dagen`);
        }
        
        socket.end();
        resolve();
      });
      socket.setTimeout(8_000, () => { socket.destroy(); reject(new Error("Timeout")); });
      socket.on("error", reject);
    });
    
    return graded([1, issues.length === 0 ? 1 : 0], issues.length === 0, issues.length === 0 ? "SSL-certificaatchain is geldig en correct geconfigureerd." : `Certificaat: ${issues.join("; ")}.`);
  } catch (error) {
    return { status: "fail" as const, detail: `SSL-validatie mislukt: ${error instanceof Error ? error.message : "onbekende fout"}.`, score: 0 };
  }
}

async function checkDnsSafety(hostname: string) {
  try {
    const issues: string[] = [];
    
    // Check MX records (mail safety)
    try {
      const mxRecords = await resolveMx(hostname);
      if (mxRecords.length === 0) {
        issues.push("Geen MX-records gevonden");
      }
    } catch {
      issues.push("MX-record opzoeking mislukt");
    }
    
    return check(issues.length === 0, issues.length === 0 ? "MX-records voor mail-routing zijn aanwezig." : `DNS issues: ${issues.join("; ")}.`);
  } catch (error) {
    return unavailable(`DNS-controle niet beschikbaar: ${error instanceof Error ? error.message : "onbekende fout"}`);
  }
}

async function testFormSubmission(url: string, artifactsPath: string, scanId: string) {
  await assertPublicWebUrl(url);
  try {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const submissionDetails: { formName: string; formPath: string; submissionTime: string; success: boolean; notes?: string }[] = [];
    
    try {
      await blockUnsafeRequests(page);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      
      // Find all forms
      const forms = await page.locator("form").all();
      if (forms.length === 0) {
        await browser.close();
        return unavailable("Geen formulieren gevonden op de pagina.");
      }
      
      // Try to find and test a contact form
      for (const form of forms.slice(0, 3)) {
        // Max 3 forms to test
        try {
          const formName = await form.getAttribute("name") ?? await form.getAttribute("id") ?? "onbekend";
          const formAction = await form.getAttribute("action") ?? url;
          
          // Look for input fields
          const inputs = await form.locator("input[type='text'], input[type='email'], textarea").all();
          if (inputs.length === 0) continue;
          
          // Fill in some test data
          let filledCount = 0;
          for (const input of inputs.slice(0, 2)) {
            const type = await input.getAttribute("type");
            const name = await input.getAttribute("name") ?? "";
            
            if (name.toLowerCase().includes("email")) {
              await input.fill("test@example.com");
            } else if (name.toLowerCase().includes("name")) {
              await input.fill("Test User");
            } else if (type === "email") {
              await input.fill("test@example.com");
            } else {
              await input.fill("Test message");
            }
            filledCount++;
          }
          
          if (filledCount === 0) continue;
          
          // Try to submit
          const submitButton = await form.locator("button[type='submit'], input[type='submit']").first();
          if (!submitButton) continue;
          
          let submitSuccess = false;
          try {
            await Promise.race([
              submitButton.click(),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Submit timeout")), 5000)),
            ]);
            
            // Check if we got a success message or stayed on page
            await page.waitForTimeout(1000);
            const currentUrl = page.url();
            const pageText = await page.locator("body").innerText();
            
            submitSuccess = currentUrl !== url || /success|bedankt|dank|verzonden/i.test(pageText);
          } catch {
            submitSuccess = false;
          }
          
          submissionDetails.push({
            formName,
            formPath: formAction,
            submissionTime: new Date().toISOString(),
            success: submitSuccess,
            notes: submitSuccess ? "Formulier succesvol ingediend" : "Formulier-indiening kon niet bevestigd worden",
          });
        } catch {
          // Skip this form
        }
      }
      
      await browser.close();
      
      if (submissionDetails.length === 0) {
        return unavailable("Geen testbare formulieren gevonden.");
      }
      
      const successCount = submissionDetails.filter((d) => d.success).length;
      const totalTested = submissionDetails.length;
      const passed = successCount === totalTested;
      
      return graded([successCount / totalTested], passed, `${successCount}/${totalTested} formulieren succesvol getest. Opmerking: dit is geautomatiseerde testing; controleer handmatig of berichten werkelijk zijn binnengekomen.`);
    } catch (error) {
      await browser.close();
      return unavailable(`Formulier-test mislukt: ${error instanceof Error ? error.message : "onbekende fout"}`);
    }
  } catch (error) {
    return unavailable(`Formulier-testing niet beschikbaar: ${error instanceof Error ? error.message : "onbekende fout"}`);
  }
}