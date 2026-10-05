import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aiResultsSchema, technicalResultsSchema, type AiResults, type TechnicalResults } from "@quickscan/contracts";

export async function generateReport(scanId: string, artifactsPath: string, technical: TechnicalResults, ai?: AiResults, aiError?: string): Promise<void> {
  const directory = join(artifactsPath, scanId);
  const home = JSON.parse(await readFile(join(directory, "homepage.json"), "utf8")) as { title: string; url: string };
  await writeFile(join(directory, "report.json"), JSON.stringify({
    home: { title: home.title, url: home.url },
    technical: technicalResultsSchema.parse(technical),
    ai: ai ? aiResultsSchema.parse(ai) : undefined,
    aiError,
    generatedAt: new Date().toISOString(),
  }));
}