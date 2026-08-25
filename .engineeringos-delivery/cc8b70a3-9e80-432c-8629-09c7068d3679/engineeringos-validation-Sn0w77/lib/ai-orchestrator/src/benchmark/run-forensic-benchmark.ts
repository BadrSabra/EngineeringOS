import path from "node:path";
import process from "node:process";
import {
  runDeterministicForensicBenchmark,
  runLiveForensicBenchmark,
  writeScorecardFiles,
} from "./forensic-benchmark.js";
import type { ProviderId } from "../provider-registry.js";

const providerNames: ProviderId[] = ["openrouter", "gemini", "deepseek", "groq"];
const envKeyByProvider: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
};

function isProvider(value: string | undefined): value is ProviderId {
  return providerNames.includes(value as ProviderId);
}

const requestedProvider = process.env.BENCHMARK_PROVIDER;
const outputDir = process.env.BENCHMARK_OUTPUT_DIR ?? path.resolve("benchmark-results");
const rootPath = process.env.BENCHMARK_ROOT_PATH ?? process.cwd();

if (requestedProvider && !isProvider(requestedProvider)) {
  throw new Error(`BENCHMARK_PROVIDER must be one of: ${providerNames.join(", ")}`);
}
const selectedProvider = requestedProvider as ProviderId | undefined;
const selectedModel = process.env.BENCHMARK_MODEL?.trim() || undefined;

const deterministic = runDeterministicForensicBenchmark();
await writeScorecardFiles(deterministic, outputDir);

const providers: ProviderId[] = selectedProvider ? [selectedProvider] : providerNames;
const liveScorecards = [];
const skippedProviders: Array<{ provider: ProviderId; reason: string }> = [];

for (const provider of providers) {
  const apiKey = process.env[envKeyByProvider[provider]];
  if (!apiKey) {
    skippedProviders.push({ provider, reason: `${envKeyByProvider[provider]} is not configured` });
    continue;
  }
  const scorecard = await runLiveForensicBenchmark({
    provider,
    apiKey,
    rootPath,
    model: selectedModel,
  });
  liveScorecards.push(scorecard);
  await writeScorecardFiles(scorecard, path.join(outputDir, provider));
}

const summary = {
  deterministic,
  live: liveScorecards.map((scorecard) => ({
    provider: scorecard.provider,
    model: scorecard.model,
    metrics: scorecard.metrics,
  })),
  skippedProviders,
};

await writeScorecardFiles(
  { ...deterministic, skippedProviders },
  outputDir,
);
console.log(JSON.stringify(summary, null, 2));