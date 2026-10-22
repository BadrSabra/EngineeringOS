#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeEngineeringAgentSourceFingerprint } from "./engineering-agent-source-fingerprint.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownerMissionTestId =
  "authenticated owner-Mission link preserves active Mission across Chat navigation and reload";

function runCommand(command, args, { env = process.env, capture = false, timeoutMs = 600_000 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      killTimer.unref();
    }, timeoutMs);
    timeout.unref();
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      resolveRun({
        exitCode: typeof code === "number" ? code : 1,
        signal: signal ?? null,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
}

function parseJsonOutput(text) {
  for (const line of text.split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // The smoke may write harmless wrapper lines; inspect only complete JSON objects.
    }
  }
  return null;
}

export function classifyOpenRouterSmokeResult(result, exitCode, stderr = "") {
  if (!result) {
    return {
      status: "FAIL_INFRA",
      provider: "openrouter",
      failureCategory: stderr.includes("OPENROUTER_API_KEY is required")
        ? "missing_credentials"
        : "smoke_result_missing",
      actualModel: null,
      freePolicy: false,
      responseValidation: "not_verified",
      paidFallbackEnabled: false,
      attemptCount: 0,
      maxAttempts: 1,
      rateLimitScope: null,
      retryAfterMs: null,
    };
  }

  const safeResult = {
    provider: result.provider === "openrouter" ? "openrouter" : null,
    actualModel: typeof result.actualModel === "string" ? result.actualModel : null,
    selectedModel: typeof result.selectedModel === "string" ? result.selectedModel : null,
    freePolicy: result.freePolicy === true,
    actualModelFreeVerified: result.actualModelFreeVerified === true,
    responseValidation: [
      "passed",
      "failed",
      "not_attempted",
      "not_verified",
    ].includes(result.responseValidation)
      ? result.responseValidation
      : "not_verified",
    paidFallbackEnabled: result.paidFallbackEnabled === true,
    attemptCount: Number.isInteger(result.attemptCount) ? result.attemptCount : 0,
    maxAttempts: Number.isInteger(result.maxAttempts) ? result.maxAttempts : 1,
    failureCategory: typeof result.failureCategory === "string"
      ? result.failureCategory
      : null,
    rateLimitScope: [
      "upstream_shared_pool",
      "provider_credential",
      "account_quota",
      "unknown",
    ].includes(result.rateLimitScope)
      ? result.rateLimitScope
      : null,
    retryAfterMs: Number.isSafeInteger(result.retryAfterMs) && result.retryAfterMs > 0
      ? result.retryAfterMs
      : null,
  };

  if (
    result.failureCategory === "rate-limit"
    && result.status !== "passed"
  ) {
    return { ...safeResult, status: "BLOCKED_RATE_LIMIT" };
  }
  if (
    result.failureCategory === "routing"
    || result.actualModelFreeVerified === false
    || safeResult.provider !== "openrouter"
  ) {
    return { ...safeResult, status: "FAIL_ROUTING" };
  }
  if (
    result.responseValidation === "failed"
    || ["empty-response", "capability"].includes(result.failureCategory)
  ) {
    return { ...safeResult, status: "FAIL_RESPONSE" };
  }
  if (
    result.status === "passed"
    && result.provider === "openrouter"
    && result.freePolicy === true
    && result.actualModelFreeVerified === true
    && result.responseValidation === "passed"
    && result.paidFallbackEnabled === false
    && exitCode === 0
  ) {
    return { ...safeResult, status: "PASS" };
  }
  return { ...safeResult, status: "FAIL_INFRA" };
}

async function writeJsonAtomically(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(contents);
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function runRequiredGate(gateName, gate, command, args, env) {
  gate.command = [command, ...args].join(" ");
  console.log(`\n[acceptance] ${gateName}`);
  const result = await runCommand(command, args, { env });
  gate.exitCode = result.exitCode;
  gate.status = result.exitCode === 0 && !result.timedOut ? "PASS" : "FAIL";
  if (result.timedOut) gate.failureCategory = "timeout";
  if (gate.status !== "PASS") throw new Error(`gate_failed:${gateName}`);
}

async function main() {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const sourceFingerprint = await computeEngineeringAgentSourceFingerprint({
    cwd: workspaceRoot,
  });
  const evidenceRoot = resolve(workspaceRoot, "release-evidence/engineering-agent-final-acceptance");
  const summaryPath = resolve(evidenceRoot, `${runId}.json`);
  const receiptPath = resolve(
    workspaceRoot,
    "release-evidence/engineering-agent-lifecycle",
    `${runId}.json`,
  );
  const offlineVerificationPath = resolve(
    workspaceRoot,
    "release-evidence/engineering-agent-lifecycle",
    `${runId}.acceptance-offline-verification.json`,
  );
  const summary = {
    schemaVersion: 1,
    runId,
    startedAt,
    sourceRevision,
    sourceFingerprint,
    status: "FAILED",
    deploymentStatus: "NOT_DEPLOYED",
    gates: {
      ownerMissionNavigation: {
        status: "NOT_RUN",
        testId: ownerMissionTestId,
      },
      apiMissionHandoffAuthorization: {
        status: "NOT_RUN",
        testId: "missions.test.ts cross-project and cross-session active-Mission selection",
      },
      lifecycleJourney: { status: "NOT_RUN" },
      lifecycleReceiptOfflineVerification: {
        status: "NOT_RUN",
        receiptFile: "NOT_CREATED",
        sourceFingerprint,
      },
      apiTypecheck: { status: "NOT_RUN" },
      dashboardTypecheck: { status: "NOT_RUN" },
      openApiGeneratedDrift: { status: "NOT_RUN" },
      openRouterFreePath: {
        status: "NOT_RUN",
        provider: "openrouter",
        correlationId: runId,
      },
    },
  };

  let currentGate = "ownerMissionNavigation";
  let exitCode = 1;
  try {
    const journeyEnv = {
      ...process.env,
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      RELEASE_VALIDATION_WAIT_FOR_LOCK: process.env.RELEASE_VALIDATION_WAIT_FOR_LOCK ?? "1",
      DASHBOARD_E2E_BROWSER: process.env.DASHBOARD_E2E_BROWSER ?? "firefox",
      DASHBOARD_E2E_SKIP_API_CONTRACTS: "1",
      DASHBOARD_E2E_GREP: ownerMissionTestId,
      PLAYWRIGHT_OUTPUT_DIR: `test-results/engineering-agent-final-acceptance/${runId}/owner-link`,
    };
    if (!journeyEnv.APP_ORIGINS && process.env.REPLIT_DEV_DOMAIN) {
      journeyEnv.APP_ORIGINS = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    }
    await runRequiredGate(
      currentGate,
      summary.gates.ownerMissionNavigation,
      "pnpm",
      ["run", "validate:dashboard-journey"],
      journeyEnv,
    );

    currentGate = "apiMissionHandoffAuthorization";
    await runRequiredGate(
      currentGate,
      summary.gates.apiMissionHandoffAuthorization,
      "pnpm",
      ["run", "test:mission-control"],
      process.env,
    );

    currentGate = "lifecycleReceiptOfflineVerification";
    const lifecycleEnv = {
      ...process.env,
      ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
      ENGINEERING_AGENT_LIFECYCLE_RUN_ID: runId,
      ENGINEERING_AGENT_LIFECYCLE_STARTED_AT: startedAt,
    };
    delete lifecycleEnv.DASHBOARD_E2E_GREP;
    delete lifecycleEnv.GOAL_FIRST_LIVE_PROVIDER;
    await runRequiredGate(
      "correlated lifecycle journey",
      summary.gates.lifecycleJourney,
      "pnpm",
      ["run", "validate:engineering-agent-lifecycle-e2e"],
      lifecycleEnv,
    );

    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (
      receipt.status !== "passed"
      || receipt.stage !== "complete"
      || receipt.runId !== runId
      || receipt.sourceFingerprint !== sourceFingerprint
    ) {
      throw new Error("lifecycle_receipt_binding_mismatch");
    }
    const offlineEnv = { ...process.env };
    for (const key of Object.keys(offlineEnv)) {
      if (key.startsWith("PG") || key === "DATABASE_URL") delete offlineEnv[key];
    }
    delete offlineEnv.ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT;
    delete offlineEnv.ENGINEERING_AGENT_LIFECYCLE_REMOTE;
    await runRequiredGate(
      "offline lifecycle receipt verification",
      summary.gates.lifecycleReceiptOfflineVerification,
      "node",
      [
        "scripts/verify-engineering-agent-lifecycle-receipt.mjs",
        "--offline",
        receiptPath,
        offlineVerificationPath,
      ],
      offlineEnv,
    );
    const verification = JSON.parse(await readFile(offlineVerificationPath, "utf8"));
    if (
      verification.status !== "passed"
      || verification.mode !== "offline"
      || verification.runId !== runId
      || verification.sourceFingerprint !== sourceFingerprint
    ) {
      throw new Error("offline_receipt_verification_mismatch");
    }
    summary.gates.lifecycleReceiptOfflineVerification = {
      status: "PASS",
      receiptFile: "release-evidence/engineering-agent-lifecycle/" + `${runId}.json`,
      verificationFile: "release-evidence/engineering-agent-lifecycle/" + `${runId}.acceptance-offline-verification.json`,
      receiptSha256: verification.receiptSha256,
      sourceFingerprint,
      runId,
      testId: receipt.testId,
    };

    currentGate = "apiTypecheck";
    await runRequiredGate(
      currentGate,
      summary.gates.apiTypecheck,
      "pnpm",
      ["--filter", "@workspace/api-server", "run", "typecheck"],
      process.env,
    );
    currentGate = "dashboardTypecheck";
    await runRequiredGate(
      currentGate,
      summary.gates.dashboardTypecheck,
      "pnpm",
      ["--filter", "@workspace/dashboard", "run", "typecheck"],
      process.env,
    );
    currentGate = "openApiGeneratedDrift";
    await runRequiredGate(
      currentGate,
      summary.gates.openApiGeneratedDrift,
      "pnpm",
      ["run", "codegen:check"],
      process.env,
    );

    currentGate = "openRouterFreePath";
    const smokeStartedAt = new Date().toISOString();
    const smokeEnv = {
      ...process.env,
      RUN_LIVE_OPENROUTER_FREE_SMOKE: "1",
      OPENROUTER_SMOKE_MAX_ATTEMPTS: "1",
      OPENROUTER_SMOKE_TIMEOUT_MS: "12000",
    };
    console.log("\n[acceptance] OpenRouter free-path live smoke (one bounded attempt)");
    const smokeRun = await runCommand(
      "pnpm",
      ["--filter", "@workspace/api-server", "run", "smoke:openrouter-free"],
      { env: smokeEnv, capture: true, timeoutMs: 120_000 },
    );
    const smokeResult = parseJsonOutput(smokeRun.stdout);
    summary.gates.openRouterFreePath = {
      ...classifyOpenRouterSmokeResult(
        smokeResult,
        smokeRun.exitCode,
        smokeRun.stderr,
      ),
      commandExitCode: smokeRun.exitCode,
      startedAt: smokeStartedAt,
      finishedAt: new Date().toISOString(),
      correlationId: runId,
    };
    if (summary.gates.openRouterFreePath.status === "PASS") {
      summary.status = "PASSED";
      exitCode = 0;
    } else if (summary.gates.openRouterFreePath.status === "BLOCKED_RATE_LIMIT") {
      summary.status = "BLOCKED_RATE_LIMIT";
      exitCode = 2;
    } else {
      summary.status = "FAILED";
      exitCode = 1;
    }
  } catch {
    summary.status = "FAILED";
    if (summary.gates[currentGate]) {
      summary.gates[currentGate].status = "FAIL";
    }
    summary.failure = {
      gate: currentGate,
      category: "acceptance_gate_failed",
    };
    exitCode = 1;
  } finally {
    summary.finishedAt = new Date().toISOString();
    try {
      summary.sourceFingerprintAfter = await computeEngineeringAgentSourceFingerprint({
        cwd: workspaceRoot,
      });
      if (summary.sourceFingerprintAfter !== sourceFingerprint) {
        summary.status = "FAILED";
        summary.failure = {
          gate: currentGate,
          category: "source_changed_during_acceptance",
        };
        exitCode = 1;
      }
    } catch {
      summary.sourceFingerprintAfter = null;
      summary.status = "FAILED";
      summary.failure = {
        gate: currentGate,
        category: "source_fingerprint_unavailable",
      };
      exitCode = 1;
    }
    await writeJsonAtomically(summaryPath, summary);
    console.log(JSON.stringify({
      status: summary.status,
      summaryFile: `release-evidence/engineering-agent-final-acceptance/${runId}.json`,
      sourceFingerprint,
      deploymentStatus: summary.deploymentStatus,
      gates: summary.gates,
    }));
  }
  return exitCode;
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch(() => { process.exitCode = 1; });
}

export { main };
