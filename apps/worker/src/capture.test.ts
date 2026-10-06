import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateReport } from "./report.js";
import { AiEvaluationError, evaluateSite, normalizeAiResult } from "./ai.js";
import { selectRelevantLinks } from "./capture.js";
import { assessAccessibility, assessCls, assessLinksMedia, assessMobile, assessSecurityHeaders, assessSeo, assessSocialMetadata, isExposureContent, pageSpeed } from "./technical.js";
import { assertPublicWebUrl } from "@quickscan/site-policy";

test("network policy rejects private, mapped, link-local and reserved addresses", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.0.2.1", "[::1]", "[::ffff:127.0.0.1]", "[fe90::1]", "[fd00::1]", "[2001:db8::1]"]) {
    await assert.rejects(assertPublicWebUrl(`http://${address}`));
  }
  assert.equal((await assertPublicWebUrl("https://8.8.8.8")).hostname, "8.8.8.8");
  assert.equal((await assertPublicWebUrl("https://[2606:4700:4700::1111]")).hostname, "[2606:4700:4700::1111]");
});

test("reports contain only result data and do not generate HTML or PDF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quickscan-results-"));
  try {
    await mkdir(join(directory, "scan"));
    await writeFile(join(directory, "scan", "homepage.json"), JSON.stringify({ title: "Example", url: "https://example.com", html: "<html>large page</html>", screenshot: "base64" }));
    await generateReport("scan", directory, { https: { status: "pass", score: 5, scoreType: "binary", detail: "HTTPS actief." } }, undefined, "AI niet beschikbaar.");
    const results = JSON.parse(await readFile(join(directory, "scan", "report.json"), "utf8"));
    assert.deepEqual(results.home, { title: "Example", url: "https://example.com" });
    assert.equal(results.technicalScoreMax, 5);
    assert.equal(results.technical.https.score, 5);
    assert.equal(results.technical.https.scoreType, "binary");
    assert.equal(results.aiError, "AI niet beschikbaar.");
    assert.deepEqual((await readdir(join(directory, "scan"))).sort(), ["homepage.json", "report.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selectRelevantLinks keeps the three highest-priority internal candidates", () => {
  const selected = selectRelevantLinks([
    { text: "Nieuws", url: "https://example.test/nieuws" },
    { text: "Vrijwilligers", url: "https://example.test/vrijwilligers" },
    { text: "Contact", url: "https://example.test/contact" },
    { text: "Speltakken", url: "https://example.test/speltakken" },
    { text: "Kom meedoen", url: "https://example.test/meedoen" },
  ]);

  assert.deepEqual(selected.map(({ text }) => text), ["Contact", "Kom meedoen", "Speltakken"]);
});

test("normalizeAiResult accepts Gemini's criteria array", () => {
  const criterion = { score: 3, toelichting: "Aanwezig.", verbeterpunt: "Verbeter dit.", insufficientEvidence: false };
  const result = normalizeAiResult({ criteria: Array.from({ length: 8 }, () => criterion) });
  assert.equal(Object.keys(result.criteria).length, 8);
  assert.equal(result.criteria.mobiele_ervaring?.score, 3);
});

test("normalizeAiResult repairs plain text and common criterion aliases", () => {
  const result = normalizeAiResult({ criteria: { call_to_action: "Een duidelijke aanmeldknop ontbreekt.", informationarchitectuur: { score: 2, toelichting: "Informatie staat verspreid.", verbeterpunt: "Groepeer praktische informatie.", insufficientEvidence: false } } });
  assert.equal(result.criteria.call_to_action?.score, 3);
  assert.equal(result.criteria.informatiearchitectuur?.score, 2);
});

test("evaluateSite requests structured JSON and diagnoses invalid Gemini responses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quickscan-ai-"));
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const criterion = { score: 3, toelichting: "Aanwezig.", verbeterpunt: "Verbeter dit.", insufficientEvidence: false };
  const text = JSON.stringify({ criteria: { beeldgebruik: criterion } });
  let reply: unknown = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "internal reasoning", thought: true }, { text: text.slice(0, 30) }, { text: text.slice(30) }] } }] };
  try {
    await mkdir(join(directory, "scan"));
    await writeFile(join(directory, "scan", "homepage.json"), JSON.stringify({ text: "Scouting" }));
    await writeFile(join(directory, "scan", "home-desktop.png"), "fixture");
    await writeFile(join(directory, "scan", "home-mobile.png"), "fixture");
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.generationConfig.responseMimeType, "application/json");
      const schema = request.generationConfig.responseSchema.properties.criteria;
      assert.equal(schema.required.length, 9);
      assert.equal(schema.properties.beeldgebruik.properties.score.maximum, 5);
      return new Response(JSON.stringify(reply), { status: 200 });
    };
    assert.equal((await evaluateSite("scan", directory))?.criteria.beeldgebruik?.score, 3);

    reply = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"criteria":{"beeldgebruik":{"score":3 "toelichting":"broken"}}}' }] } }] };
    await assert.rejects(evaluateSite("scan", directory), (error: unknown) => {
      assert.ok(error instanceof AiEvaluationError);
      assert.match(error.message, /Gemini-analyse kon niet worden verwerkt/);
      assert.equal(error.details.finishReason, "STOP");
      assert.equal(error.details.responseArtifact, "ai-response.json");
      assert.ok(Number(error.details.responseLength) > 0);
      return true;
    });
    assert.deepEqual(JSON.parse(await readFile(join(directory, "scan", "ai-response.json"), "utf8")), reply);

    reply = { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text }] } }] };
    await assert.rejects(evaluateSite("scan", directory), /Gemini brak de analyse af \(MAX_TOKENS\)/);
    reply = { promptFeedback: { blockReason: "SAFETY" } };
    await assert.rejects(evaluateSite("scan", directory), /geen analyse terug \(SAFETY\)/);
    assert.equal((await readdir(join(directory, "scan"))).includes("report.json"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    await rm(directory, { recursive: true, force: true });
  }
});

test("assessMobile flags overflow and small touch targets", () => {
  const result = assessMobile({ viewport: true, horizontalOverflow: true, smallTargets: 2, obscuredTargets: 0, totalTargets: 10 });
  assert.equal(result.status, "warning");
  assert.equal(result.score, 3.5);
  assert.match(result.detail, /horizontale scroll/);
});

test("CLS distinguishes a valid zero from unavailable evidence", () => {
  assert.equal(assessCls(0).status, "pass");
  assert.equal(assessCls(0.2).status, "warning");
  assert.equal(assessCls(undefined).status, "unavailable");
  assert.equal(assessCls(Number.NaN).status, "unavailable");
});

test("exposure probes require sensitive content", () => {
  assert.equal(isExposureContent("/.git/HEAD", "ref: refs/heads/main\n"), true);
  assert.equal(isExposureContent("/.git/HEAD", "<!doctype html><title>Homepage</title>"), false);
});

test("accessibility and SEO checks identify missing basics", () => {
  assert.equal(assessAccessibility({ language: false, missingAlt: 1, unlabeledFields: 0, totalImages: 2, totalFields: 1 }).status, "warning");
  assert.equal(assessSeo({ titleLength: 61, descriptionLength: 0, h1: true, canonical: false, skippedHeadings: 0 }).status, "warning");
  assert.equal(assessSocialMetadata({ openGraph: true, xCard: false }).status, "warning");
});

test("technical scores reflect subchecks and proportions on a 0-5 scale", () => {
  assert.equal(assessSecurityHeaders(0, "Aanwezig").score, 5);
  assert.equal(assessSecurityHeaders(1, "Ontbreekt").score, 3.3);
  assert.equal(assessSecurityHeaders(3, "Ontbreekt").score, 0);
  assert.equal(assessSocialMetadata({ openGraph: true, xCard: false }).score, 2.5);
  assert.equal(assessSeo({ titleLength: 40, descriptionLength: 100, h1: true, canonical: false, skippedHeadings: 0 }).score, 4);
  assert.equal(assessCls(0).score, 5);
  assert.equal(assessCls(0.25).score, 2.5);
  assert.equal(assessCls(0.5).score, 0);
  assert.equal(assessCls(0.3).status, "fail");
  const accessibility = { language: true, missingAlt: 1, unlabeledFields: 0, totalFields: 0 };
  assert.ok(assessAccessibility({ ...accessibility, totalImages: 100 }).score > assessAccessibility({ ...accessibility, totalImages: 2 }).score);
  assert.equal(assessAccessibility({ ...accessibility, missingAlt: 0, totalImages: 0 }).score, 5);
  assert.equal(assessLinksMedia({ checkedLinks: 10, brokenLinks: 2, checkedImages: 10, brokenImages: 0 }).score, 4.5);
  assert.equal(assessLinksMedia({ checkedLinks: 0, brokenLinks: 0, checkedImages: 0, brokenImages: 0 }).status, "unavailable");
});

test("PageSpeed preserves Lighthouse scores and separates missing evidence from zero", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_PAGESPEED_API_KEY;
  let performance: number | undefined = 0.76;
  try {
    process.env.GOOGLE_PAGESPEED_API_KEY = "test-key";
    globalThis.fetch = async () => new Response(JSON.stringify({ lighthouseResult: { categories: { performance: { score: performance } }, audits: { "cumulative-layout-shift": { numericValue: 0 } } } }));
    const measured = await pageSpeed("https://example.com");
    assert.equal(measured.score, 3.8);
    assert.equal(measured.status, "warning");
    assert.equal(measured.clsScore, 0);
    assert.match(measured.detail, /FCP: niet beschikbaar/);
    performance = 0;
    assert.equal((await pageSpeed("https://example.com")).score, 0);
    assert.equal((await pageSpeed("https://example.com")).status, "fail");
    performance = 1;
    assert.equal((await pageSpeed("https://example.com")).score, 5);
    assert.equal((await pageSpeed("https://example.com")).status, "pass");
    performance = undefined;
    assert.equal((await pageSpeed("https://example.com")).status, "unavailable");
    performance = 2;
    assert.equal((await pageSpeed("https://example.com")).status, "unavailable");
    delete process.env.GOOGLE_PAGESPEED_API_KEY;
    assert.equal((await pageSpeed("https://example.com")).status, "unavailable");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOOGLE_PAGESPEED_API_KEY;
    else process.env.GOOGLE_PAGESPEED_API_KEY = originalKey;
  }
});