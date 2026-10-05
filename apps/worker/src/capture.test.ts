import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateReport } from "./report.js";
import { normalizeAiResult } from "./ai.js";
import { selectRelevantLinks } from "./capture.js";
import { assessAccessibility, assessCls, assessMobile, assessSeo, assessSocialMetadata, isExposureContent } from "./technical.js";
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
    await generateReport("scan", directory, { https: { status: "pass", score: 100, detail: "HTTPS actief." } }, undefined, "AI niet beschikbaar.");
    const results = JSON.parse(await readFile(join(directory, "scan", "report.json"), "utf8"));
    assert.deepEqual(results.home, { title: "Example", url: "https://example.com" });
    assert.equal(results.technical.https.score, 100);
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

test("assessMobile flags overflow and small touch targets", () => {
  const result = assessMobile({ viewport: true, horizontalOverflow: true, smallTargets: 2, obscuredTargets: 0 });
  assert.equal(result.status, "warning");
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
  assert.equal(assessAccessibility({ language: false, missingAlt: 1, unlabeledFields: 0 }).status, "warning");
  assert.equal(assessSeo({ titleLength: 61, descriptionLength: 0, h1: true, canonical: false, skippedHeadings: 0 }).status, "warning");
  assert.equal(assessSocialMetadata({ openGraph: true, xCard: false }).status, "warning");
});