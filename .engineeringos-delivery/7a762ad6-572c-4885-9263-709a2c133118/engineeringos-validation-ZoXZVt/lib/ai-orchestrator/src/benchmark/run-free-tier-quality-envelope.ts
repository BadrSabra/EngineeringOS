import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildFreeTierQualityEnvelopeFromRuns,
  type FreeTierQualityEnvelope,
} from "./free-tier-quality-envelope.js";

const corpusDir = path.resolve(
  process.env.BENCHMARK_FREE_TIER_CORPUS_DIR ?? "benchmark-results/free-tier-shards",
);
const outputDir = path.resolve(
  process.env.BENCHMARK_FREE_TIER_ENVELOPE_OUTPUT_DIR ?? corpusDir,
);

async function findRunFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findRunFiles(entryPath));
    } else if (entry.isFile() && entry.name === "code-agent-benchmark-airlock.run.json") {
      files.push(entryPath);
    }
  }
  return files.sort();
}

const runFiles = await findRunFiles(corpusDir);
if (runFiles.length === 0) {
  throw new Error(`No free-tier Airlock run files found in ${corpusDir}.`);
}
const runs = await Promise.all(runFiles.map(async (filePath) =>
  JSON.parse(await fs.readFile(filePath, "utf8")) as unknown,
));
const { corpus, envelope } = buildFreeTierQualityEnvelopeFromRuns({
  runs,
  generatedAt: new Date().toISOString(),
});

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, "free-tier-quality-replay-corpus.json"),
  `${JSON.stringify(corpus, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(outputDir, "free-tier-quality-envelope.json"),
  `${JSON.stringify(envelope, null, 2)}\n`,
  "utf8",
);

const summary: Pick<
  FreeTierQualityEnvelope,
  "kind" | "mode" | "corpus" | "coverage" | "qualityGradeCounts" | "qualityEligible" | "qualityComparisonAllowed" | "rolloutAllowed" | "rolloutBlockers"
> = {
  kind: envelope.kind,
  mode: envelope.mode,
  corpus: envelope.corpus,
  coverage: envelope.coverage,
  qualityGradeCounts: envelope.qualityGradeCounts,
  qualityEligible: envelope.qualityEligible,
  qualityComparisonAllowed: envelope.qualityComparisonAllowed,
  rolloutAllowed: envelope.rolloutAllowed,
  rolloutBlockers: envelope.rolloutBlockers,
};
console.log(JSON.stringify({
  ...summary,
  corpusDir,
  outputDir,
  runFiles: runFiles.length,
}, null, 2));