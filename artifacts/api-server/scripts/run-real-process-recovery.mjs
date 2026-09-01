#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const providerEnvironment = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
};
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiServerRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(apiServerRoot, "../..");
const buildArtifact = "artifacts/api-server/dist/index.mjs";
const buildArtifactPath = path.join(workspaceRoot, "artifacts/api-server/dist/index.mjs");
const defaultReceiptPath = path.join(workspaceRoot, "release-evidence/live-process-recovery.json");
const liveProvider =
  process.env.LIVE_RECOVERY_PROVIDER ||
  Object.entries(providerEnvironment).find(([, variable]) => process.env[variable])?.[0];
const requiredEnvironment = ["DATABASE_URL", providerEnvironment[liveProvider]];
const missingEnvironment = requiredEnvironment.filter((name) => !name || !process.env[name]);

if (process.env.RUN_REAL_API_PROCESS_RECOVERY !== "1") {
  console.error(
    "SKIP: real process-recovery validation is opt-in. Set RUN_REAL_API_PROCESS_RECOVERY=1 to run it.",
  );
  process.exit(0);
}

if (!liveProvider || missingEnvironment.length > 0) {
  console.error(
    `Real process-recovery validation requires provider/database configuration: ${missingEnvironment.filter(Boolean).join(", ")}.`,
  );
  console.error(
    "This check is intentionally opt-in; run it only in a controlled release-validation environment.",
  );
  process.exit(2);
}

if (
  liveProvider === "openrouter" &&
  process.env.OPENROUTER_MODEL &&
  !process.env.OPENROUTER_MODEL.trim().endsWith(":free")
) {
  console.error("OpenRouter recovery accepts only a model explicitly marked :free.");
  process.exit(2);
}

const secretValues = Object.values(process.env).filter(
  (value) => typeof value === "string" && value.length >= 8,
);

function redact(value) {
  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
    value,
  );
}

function parseTimeoutMs() {
  const configured = Number(process.env.RELEASE_PROCESS_RECOVERY_TIMEOUT_MS ?? 180_000);
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new Error("RELEASE_PROCESS_RECOVERY_TIMEOUT_MS must be a positive integer.");
  }
  return configured;
}

function parseSafeModel(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$/.test(value)) {
    throw new Error("Live recovery did not report a safe selected model.");
  }
  return value;
}

function parseLiveEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Live recovery did not produce a structured evidence payload.");
  }
  const candidate = value;
  const provider = candidate.provider;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error("Live recovery evidence is missing provider details.");
  }
  if (
    !Object.hasOwn(providerEnvironment, provider.id) ||
    parseSafeModel(provider.model) !== provider.model ||
    typeof provider.supportsTools !== "boolean"
  ) {
    throw new Error("Live recovery evidence contains invalid provider details.");
  }
  const milestones = candidate.milestones;
  if (!milestones || typeof milestones !== "object" || Array.isArray(milestones)) {
    throw new Error("Live recovery evidence is missing milestone results.");
  }
  const expectedMilestones = {
    initialHealth: "passed",
    checkpointPersistedBeforeStop: "passed",
    checkpointSequence: "non-zero",
    firstProcessStopped: "passed",
    restartHealthyWithinBound: "passed",
    sameExecutionResumedWithOriginalResumeIdentity: "passed",
    forensicResponse: "successful",
    expectedSourcePath: "src/process-recovery.ts",
    writeOperations: "none",
    sourceBytesUnchanged: true,
  };
  for (const [key, expected] of Object.entries(expectedMilestones)) {
    if (milestones[key] !== expected) {
      throw new Error(`Live recovery milestone ${key} was not verified.`);
    }
  }
  const teardown = candidate.teardown;
  if (
    !teardown ||
    typeof teardown !== "object" ||
    Array.isArray(teardown) ||
    teardown.disposableProjectRetired !== true ||
    teardown.generatedRootRetired !== true ||
    teardown.apiDescendantsSurviving !== false ||
    teardown.recoveryListenerOccupied !== false ||
    teardown.secretsRetained !== false
  ) {
    throw new Error("Live recovery teardown was not fully verified.");
  }
  return {
    provider: {
      id: provider.id,
      model: provider.model,
      supportsTools: provider.supportsTools,
      credential: "environment-only",
      fixtureProviderCredentialsForwarded: false,
    },
    milestones: expectedMilestones,
    teardown: {
      disposableProjectRetired: true,
      generatedRootRetired: true,
      apiDescendantsSurviving: false,
      recoveryListenerOccupied: false,
      secretsRetained: false,
    },
  };
}

function readVitestCount(report, key, fallback = 0) {
  const value = report?.[key];
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function readVitestPassedFiles(report) {
  if (Array.isArray(report?.testResults)) {
    return report.testResults.filter((result) => result?.status === "passed").length;
  }
  return readVitestCount(report, "numPassedTestFiles", readVitestCount(report, "numPassedTestSuites"));
}

async function readReleaseMetadata() {
  const revision = (
    await new Promise((resolve, reject) => {
      const git = spawn("git", ["rev-parse", "--short=12", "HEAD"], {
        cwd: workspaceRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      git.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      git.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      git.once("error", reject);
      git.once("exit", (code, signal) => {
        if (signal || code !== 0) {
          reject(new Error(`Unable to resolve the release revision: ${redact(stderr).trim()}`));
          return;
        }
        resolve(stdout.trim());
      });
    })
  );
  if (!/^[0-9a-f]{7,40}$/i.test(revision)) {
    throw new Error("Git did not return a safe release revision.");
  }
  const artifactBytes = await readFile(buildArtifactPath);
  return {
    revision,
    build: {
      artifact: buildArtifact,
      sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    },
  };
}

async function writePassingReceipt(receiptPath, receipt) {
  const receiptDirectory = path.dirname(receiptPath);
  await mkdir(receiptDirectory, { recursive: true });
  const temporaryPath = path.join(
    receiptDirectory,
    `.live-process-recovery.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, receiptPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

const childEnvironment = { ...process.env };
// Do not let an unrelated parent override select a model for this check.
delete childEnvironment.OPENROUTER_MODEL;
if (liveProvider === "openrouter" && process.env.OPENROUTER_MODEL) {
  childEnvironment.OPENROUTER_MODEL = process.env.OPENROUTER_MODEL.trim();
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "live-process-recovery-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const vitestReportPath = path.join(temporaryDirectory, "vitest.json");
const receiptPath = path.resolve(process.env.LIVE_RECOVERY_RECEIPT_PATH ?? defaultReceiptPath);
const timeoutMs = parseTimeoutMs();
const startedAt = Date.now();
const child = spawn(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "src/routes/ai-stream-integration.test.ts",
    "-t",
    "recovers a forensic stream after the API process exits",
    "--reporter=json",
    `--outputFile=${vitestReportPath}`,
  ],
  {
    cwd: apiServerRoot,
    detached: true,
    env: {
      ...childEnvironment,
      NODE_ENV: "test",
      RUN_REAL_API_PROCESS_RECOVERY: "1",
      LIVE_RECOVERY_PROVIDER: liveProvider,
      LIVE_RECOVERY_RESULT_PATH: evidencePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  setTimeout(() => {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }, 5_000).unref();
}, timeoutMs);

child.stdout.on("data", (chunk) => process.stdout.write(redact(chunk.toString("utf8"))));
child.stderr.on("data", (chunk) => process.stderr.write(redact(chunk.toString("utf8"))));

child.on("error", (error) => {
  console.error(`Unable to start real process-recovery validation: ${redact(error.message)}`);
  process.exitCode = 1;
});

child.on("exit", async (code, signal) => {
  clearTimeout(timeout);
  try {
    if (timedOut) {
      console.error(`Real process-recovery validation timed out after ${timeoutMs}ms.`);
      process.exitCode = 1;
      return;
    }
    if (signal) {
      console.error(`Real process-recovery validation stopped by ${signal}.`);
      process.exitCode = 1;
      return;
    }
    if (code !== 0) {
      console.error(`Real process-recovery validation failed (exit code ${code ?? "unknown"}).`);
      process.exitCode = code ?? 1;
      return;
    }

    const evidence = parseLiveEvidence(JSON.parse(await readFile(evidencePath, "utf8")));
    const vitestReport = JSON.parse(await readFile(vitestReportPath, "utf8"));
    const releaseMetadata = await readReleaseMetadata();
    const receipt = {
      kind: "live-api-process-recovery",
      version: 1,
      redacted: true,
      ...releaseMetadata,
      provider: evidence.provider,
      command: {
        name: "test:process-recovery",
        runRealApiProcessRecovery: true,
        liveRecoveryProviderExplicit: Boolean(process.env.LIVE_RECOVERY_PROVIDER),
        timeoutMs,
      },
      result: {
        outcome: "passed",
        exitCode: 0,
        testFilesPassed: readVitestPassedFiles(vitestReport),
        testsPassed: readVitestCount(vitestReport, "numPassedTests"),
        testsSkipped: readVitestCount(vitestReport, "numPendingTests"),
        durationMs: Math.max(0, Date.now() - startedAt),
      },
      milestones: evidence.milestones,
      teardown: evidence.teardown,
    };
    if (
      receipt.result.testFilesPassed < 1 ||
      receipt.result.testsPassed < 1 ||
      receipt.result.durationMs <= 0
    ) {
      throw new Error("Live recovery did not produce complete passing test counts.");
    }
    await writePassingReceipt(receiptPath, receipt);
    console.log(`Live process-recovery receipt updated: ${path.relative(workspaceRoot, receiptPath)}`);
    console.log("Real process-recovery validation completed successfully.");
    process.exitCode = 0;
  } catch (error) {
    console.error(
      `Real process-recovery validation passed assertions but could not produce a passing receipt: ${redact(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
    process.exitCode = 1;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
});