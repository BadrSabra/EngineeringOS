#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import {
  summarizeCampaignChildFailure,
  validateAndSummarizeCampaignReceipt,
} from "./live-provider-review-receipt.mjs";

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
  const outputPath = process.env.LIVE_REVIEW_OUTPUT_PATH?.trim();
  if (outputPath) {
    const blockedReceipt = {
      kind: "code-review-provider-campaign-receipt",
      version: 1,
      scenario: scenario ?? "reasoning-only",
      provider,
      operationId: "blocked-preflight",
      projectId: "blocked-preflight",
      projectRevision: "blocked-preflight",
      outcomeClass: "terminal-incomplete",
      terminalStatus: "INCOMPLETE",
      failureCode: missing.includes(providerKeys[provider])
        ? "CREDENTIALS_MISSING"
        : "CAMPAIGN_CONFIGURATION_MISSING",
      recoveryAction: "stop-safely",
      attemptedModels: [],
      modelAttempts: [],
      fallbackReason: undefined,
      latencyMs: 0,
      evidenceStatus: "incomplete",
      accepted: false,
      evidence: [],
    };
    try {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname, resolve } = await import("node:path");
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(resolve(outputPath), `${JSON.stringify(blockedReceipt, null, 2)}\n`, "utf8");
    } catch {
      // The bounded stderr reason remains the only output when the requested
      // receipt path itself cannot be written.
    }
  }
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

const timeoutMs = Number(process.env.LIVE_REVIEW_TIMEOUT_MS ?? 300_000);
let timedOut = false;
async function readReceiptForFailure() {
  try {
    const receipt = JSON.parse(await readFile(process.env.LIVE_REVIEW_OUTPUT_PATH, "utf8"));
    validateAndSummarizeCampaignReceipt(receipt);
    return { receiptStatus: "validated", receipt };
  } catch (error) {
    return {
      receiptStatus: error?.code === "ENOENT" ? "missing" : "invalid",
    };
  }
}

async function reportChildFailure({ code, signal }) {
  const receiptResult = await readReceiptForFailure();
  const summary = summarizeCampaignChildFailure({
    code,
    signal,
    ...receiptResult,
  });
  console.error(JSON.stringify(summary));
}

const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000);

child.on("error", (error) => {
  clearTimeout(timeout);
  void reportChildFailure({ code: null, signal: null });
  process.exitCode = 1;
});

child.on("exit", async (code, signal) => {
  clearTimeout(timeout);
  if (timedOut) {
    await reportChildFailure({ code: null, signal: "SIGTERM" });
    process.exitCode = 1;
    return;
  }
  if (signal || code !== 0) {
    await reportChildFailure({ code, signal });
    process.exitCode = code ?? 1;
    return;
  }

  try {
    const receipt = JSON.parse(await readFile(process.env.LIVE_REVIEW_OUTPUT_PATH, "utf8"));
    console.log(JSON.stringify(validateAndSummarizeCampaignReceipt(receipt)));
    process.exitCode = 0;
  } catch {
    console.error(JSON.stringify({
      kind: "live-provider-review-campaign",
      status: "receipt_invalid",
    }));
    process.exitCode = 1;
  }
});