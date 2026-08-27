#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";

const scenarios = new Set([
  "reasoning-only",
  "agent-harness",
  "rate-limit",
  "empty",
  "malformed",
]);
const providerKeys = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
};

if (process.env.RUN_LIVE_PROVIDER_REVIEW_CAMPAIGN !== "1") {
  console.error(
    "SKIP: live provider review campaign is opt-in. Set RUN_LIVE_PROVIDER_REVIEW_CAMPAIGN=1 to run it.",
  );
  process.exit(0);
}

const provider = process.env.LIVE_REVIEW_PROVIDER?.trim() || "openrouter";
const scenario = process.env.LIVE_REVIEW_SCENARIO?.trim();
const required = [
  "LIVE_REVIEW_DISPOSABLE",
  "LIVE_REVIEW_PROJECT_ID",
  "LIVE_REVIEW_OUTPUT_PATH",
  providerKeys[provider],
];
if (process.env.LIVE_REVIEW_DISPOSABLE !== "1") {
  console.error("BLOCKED: set LIVE_REVIEW_DISPOSABLE=1 for the disposable campaign boundary.");
  process.exit(2);
}
if (!providerKeys[provider]) {
  console.error(`BLOCKED: unsupported LIVE_REVIEW_PROVIDER "${provider}".`);
  process.exit(2);
}
if (!scenarios.has(scenario)) {
  console.error(
    "BLOCKED: LIVE_REVIEW_SCENARIO must be reasoning-only, agent-harness, rate-limit, empty, or malformed.",
  );
  process.exit(2);
}
const missing = required.filter((name) => !name || !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`BLOCKED: live review campaign requires ${missing.join(", ")}.`);
  process.exit(2);
}

const child = spawn(
  "pnpm",
  ["exec", "tsx", "src/lib/run-live-provider-review-campaign.ts"],
  {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "test",
      RUN_LIVE_PROVIDER_REVIEW_CAMPAIGN: "1",
      LIVE_REVIEW_PROVIDER: provider,
      LIVE_REVIEW_SCENARIO: scenario,
    },
    stdio: ["ignore", "ignore", "ignore"],
  },
);

const timeoutMs = Number(process.env.LIVE_REVIEW_TIMEOUT_MS ?? 120_000);
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
}, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000);

child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(`Live provider review campaign could not start: ${error.name}.`);
  process.exitCode = 1;
});

child.on("exit", async (code, signal) => {
  clearTimeout(timeout);
  if (timedOut) {
    console.error(`Live provider review campaign timed out after ${timeoutMs}ms.`);
    process.exitCode = 1;
    return;
  }
  if (signal || code !== 0) {
    console.error(`Live provider review campaign failed (${signal ?? `exit ${code ?? "unknown"}`}).`);
    process.exitCode = code ?? 1;
    return;
  }

  try {
    const receipt = JSON.parse(await readFile(process.env.LIVE_REVIEW_OUTPUT_PATH, "utf8"));
    const serialized = JSON.stringify(receipt);
    const forbidden = ["raw", "prompt", "apiKey", "secret", "providerMessage", "provider body", "source"];
    if (forbidden.some((term) => serialized.toLowerCase().includes(term.toLowerCase()))) {
      throw new Error("receipt contains a forbidden provider/source field");
    }
    if (
      receipt.outcomeClass === "fallback-success" &&
      (receipt.terminalStatus !== "COMPLETE" || !Array.isArray(receipt.evidence) || receipt.evidence.length !== 1)
    ) {
      throw new Error("fallback success receipt is missing its cited finding");
    }
    if (
      receipt.outcomeClass === "terminal-incomplete" &&
      (receipt.terminalStatus !== "INCOMPLETE" || !Array.isArray(receipt.evidence) || receipt.evidence.length !== 0)
    ) {
      throw new Error("terminal incomplete receipt contains success evidence");
    }
    console.log(JSON.stringify({
      kind: receipt.kind,
      scenario: receipt.scenario,
      outcome: receipt.outcomeClass,
      terminal: receipt.terminalStatus,
      evidenceCount: receipt.evidence.length,
    }));
    process.exitCode = 0;
  } catch (error) {
    console.error(`Live provider review receipt failed validation: ${error.message}.`);
    process.exitCode = 1;
  }
});