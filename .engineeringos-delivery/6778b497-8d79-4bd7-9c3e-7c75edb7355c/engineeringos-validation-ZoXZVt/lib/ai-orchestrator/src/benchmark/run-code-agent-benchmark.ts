import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  CODE_AGENT_BENCHMARK_VERSION,
  codeAgentBenchmarkManifestToMarkdown,
  getCodeAgentBenchmarkCases,
  getCodeAgentBenchmarkCategoryCounts,
  validateCodeAgentBenchmarkManifest,
} from "./code-agent-benchmark.js";

const cases = getCodeAgentBenchmarkCases();
const errors = validateCodeAgentBenchmarkManifest(cases);
if (errors.length > 0) {
  throw new Error(`Invalid Code Agent benchmark manifest: ${errors.join("; ")}`);
}

const outputDir = process.env.BENCHMARK_OUTPUT_DIR ?? path.resolve("benchmark-results");
await fs.mkdir(outputDir, { recursive: true });

const manifest = {
  kind: "code-agent-benchmark-manifest",
  suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
  caseCount: cases.length,
  categoryCounts: getCodeAgentBenchmarkCategoryCounts(cases),
  cases,
};

await fs.writeFile(
  path.join(outputDir, "code-agent-benchmark-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(outputDir, "code-agent-benchmark-manifest.md"),
  `${codeAgentBenchmarkManifestToMarkdown(cases)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
  caseCount: cases.length,
  outputDir,
  note: "Manifest generated; live provider quality results are not included.",
}, null, 2));