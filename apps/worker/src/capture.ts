import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { assertPublicWebUrl } from "@quickscan/site-policy";

type CandidateLink = { text: string; url: string };

export async function captureHomepage(scanId: string, targetUrl: string, artifactsPath: string): Promise<CandidateLink[]> {
  await assertPublicWebUrl(targetUrl);
  const scanDirectory = join(artifactsPath, scanId);
  await mkdir(scanDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    await blockUnsafeRequests(desktop);
    await desktop.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await desktop.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await desktop.screenshot({ path: join(scanDirectory, "home-desktop.png"), fullPage: true, type: "png" });

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      serviceWorkers: "block",
    });
    await blockUnsafeRequests(mobile);
    await mobile.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await mobile.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await mobile.screenshot({ path: join(scanDirectory, "home-mobile.png"), fullPage: true, type: "png" });

    const text = (await desktop.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 12_000);
    const links = await extractInternalLinks(desktop, desktop.url());
    const selectedLinks = selectRelevantLinks(links);
    await writeFile(
      join(scanDirectory, "homepage.json"),
      JSON.stringify({ url: desktop.url(), title: await desktop.title(), text, capturedAt: new Date().toISOString() }, null, 2),
    );
    await writeFile(join(scanDirectory, "candidate-links.json"), JSON.stringify(links, null, 2));
    await captureSelectedPages(browser, selectedLinks, scanDirectory);
    return selectedLinks;
  } finally {
    await browser.close();
  }
}

async function extractInternalLinks(page: import("playwright").Page, pageUrl: string): Promise<CandidateLink[]> {
  const pageHost = new URL(pageUrl).hostname;
  const rawLinks = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => ({ text: (anchor as HTMLAnchorElement).innerText.trim(), url: (anchor as HTMLAnchorElement).href })),
  );
  const ignoredPath = /\.(?:pdf|zip|png|jpe?g|webp|gif|svg)$/i;
  const seen = new Set<string>();

  return rawLinks.flatMap(({ text, url }) => {
    const link = new URL(url);
    link.hash = "";
    if (
      link.hostname !== pageHost ||
      link.pathname === new URL(pageUrl).pathname ||
      ignoredPath.test(link.pathname) ||
      /\/(?:wp-admin|administrator|logout|search)(?:\/|$)/i.test(link.pathname) ||
      seen.has(link.toString())
    ) {
      return [];
    }
    seen.add(link.toString());
    return [{ text: text.replace(/\s+/g, " ").trim(), url: link.toString() }];
  });
}

export function selectRelevantLinks(links: CandidateLink[]): CandidateLink[] {
  // ponytail: keyword ranking; replace with Gemini selection when evidence shows it misses meaningful navigation labels.
  const priority = [/contact|aanmeld|lid.*word|meedoen|proef|kennismak/, /speltak|groep|leeftijd|opkomst|activiteit/, /vrijwillig|vacature|help.*mee|leiding/];
  return links
    .map((link, position) => ({
      link,
      position,
      score: priority.reduce((score, pattern, index) => score + (pattern.test(`${link.text} ${link.url}`) ? priority.length - index : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, 3)
    .map(({ link }) => link);
}

async function captureSelectedPages(
  browser: import("playwright").Browser,
  links: CandidateLink[],
  scanDirectory: string,
): Promise<void> {
  const pages = [];
  for (const [index, link] of links.entries()) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    try {
      await blockUnsafeRequests(page);
      await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const filename = `selected-${index + 1}`;
      await page.screenshot({ path: join(scanDirectory, `${filename}.png`), fullPage: true, type: "png" });
      pages.push({
        ...link,
        finalUrl: page.url(),
        title: await page.title(),
        text: (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 8_000),
      });
    } catch (error) {
      pages.push({ ...link, error: error instanceof Error ? error.message : "Pagina kon niet worden geladen." });
    } finally {
      await page.close();
    }
  }
  await writeFile(join(scanDirectory, "selected-pages.json"), JSON.stringify(pages, null, 2));
}

export async function blockUnsafeRequests(page: import("playwright").Page): Promise<void> {
  await page.route("**/*", async (route) => {
    try {
      await assertPublicWebUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort();
    }
  });
}