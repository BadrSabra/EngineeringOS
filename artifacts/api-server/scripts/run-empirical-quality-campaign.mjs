#!/usr/bin/env node

import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.RUN_EMPIRICAL_QUALITY_CAMPAIGN !== "1") {
  console.error(
    "SKIP: empirical quality campaigns are opt-in. Set RUN_EMPIRICAL_QUALITY_CAMPAIGN=1 to run one.",
  );
  process.exit(0);
}

if (process.env.EMPIRICAL_QUALITY_DISPOSABLE !== "1") {
  console.error("BLOCKED: set EMPIRICAL_QUALITY_DISPOSABLE=1 for the disposable campaign boundary.");
  process.exit(2);
}

const outputPath = process.env.EMPIRICAL_QUALITY_SCORECARD_PATH?.trim();
if (!outputPath) {
  console.error(
    "BLOCKED: set EMPIRICAL_QUALITY_SCORECARD_PATH to an output under /tmp; canonical release artifacts are protected.",
  );
  process.exit(2);
}

const provider = process.env.EMPIRICAL_QUALITY_PROVIDER?.trim() || "openrouter";
const providerKeys = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
};
if (!providerKeys[provider]) {
  console.error(`BLOCKED: unsupported EMPIRICAL_QUALITY_PROVIDER "${provider}".`);
  process.exit(2);
}
if (!process.env[providerKeys[provider]]?.trim()) {
  console.error(`BLOCKED: empirical quality campaign requires ${providerKeys[provider]}.`);
  process.exit(2);
}

const child = spawn(
  "pnpm",
  ["exec", "tsx", "src/lib/run-empirical-quality-campaign.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "test",
      RUN_EMPIRICAL_QUALITY_CAMPAIGN: "1",
      EMPIRICAL_QUALITY_DISPOSABLE: "1",
    },
    stdio: "inherit",
  },
);

const timeoutMs = Number(process.env.EMPIRICAL_QUALITY_CAMPAIGN_TIMEOUT_MS ?? 900_000);
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
}, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 900_000);

child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(`Empirical quality campaign could not start: ${error.name}.`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (timedOut) {
    console.error(`Empirical quality campaign timed out after ${timeoutMs}ms.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = signal ? 1 : code ?? 1;
});