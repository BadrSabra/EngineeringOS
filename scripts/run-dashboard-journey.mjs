#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { acquireReleaseLock, lockPath } from "../artifacts/api-server/scripts/run-release-ai-stream.mjs";

if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
  console.error(
    "Dashboard browser journey is release-only; set RUN_CONTROLLED_RELEASE_VALIDATION=1.",
  );
  process.exit(2);
}

const apiPort = Number(process.env.DASHBOARD_E2E_API_PORT ?? 8080);
const dashboardPort = Number(process.env.DASHBOARD_E2E_PORT ?? 23183);
const dashboardBaseUrl =
  process.env.DASHBOARD_E2E_BASE_URL ??
  `http://127.0.0.1:${dashboardPort}/dashboard/`;
const apiHealthUrl =
  process.env.DASHBOARD_E2E_API_HEALTH_URL ??
  `http://127.0.0.1:${apiPort}/api/healthz`;
const testEmail =
  process.env.DASHBOARD_E2E_EMAIL ??
  "engineeringos-dashboard-release@example.com";
const timeoutMs = Number(
  process.env.DASHBOARD_E2E_PREFLIGHT_TIMEOUT_MS ?? 30_000,
);
const liveTimeoutMs = Number(
  process.env.DASHBOARD_E2E_LIVE_TIMEOUT_MS ?? 120_000,
);
const workspaceRoot = resolve(new URL("..", import.meta.url).pathname);
const outputDir = resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/dashboard-journey",
);
const services = [];
let releaseLockCleanup;

function redact(value) {
  const secretValues = Object.values(process.env).filter(
    (item) => typeof item === "string" && item.length >= 8,
  );
  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
    value,
  );
}

async function waitFor(url, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        return response;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${label} did not become healthy: ${lastError} (${url})`);
}

function startService(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
    detached: true,
  });
  services.push({ label, child });
  child.on("error", (error) => {
    console.error(`${label} could not start: ${redact(error.message)}`);
  });
  return child;
}

async function waitForChild(child, label) {
  const result = await new Promise((resolveResult, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      resolveResult({ code: code ?? 1, signal }),
    );
  });
  if (result.signal || result.code !== 0) {
    throw new Error(
      `${label} failed before health checks (exit ${
        result.signal ?? result.code
      }).`,
    );
  }
}

async function stopServices() {
  for (const { child } of services) {
    if (child.exitCode !== null) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") console.error(redact(String(error)));
    }
  }
  await Promise.all(
    services.map(
      ({ child }) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          const timer = setTimeout(() => {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch (error) {
              if (error?.code !== "ESRCH") console.error(redact(String(error)));
            }
            resolve();
          }, 5_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
}

async function startReleaseServices() {
  if (process.env.DATABASE_URL) {
    releaseLockCleanup = await acquireReleaseLock(lockPath);
  }
  await mkdir(outputDir, { recursive: true });
  const chromium = process.env.DASHBOARD_E2E_EXECUTABLE_PATH;
  if (!chromium) {
    throw new Error(
      "release-dashboard-journey requires DASHBOARD_E2E_EXECUTABLE_PATH; configure Chromium before starting services.",
    );
  }
  const apiBuild = startService(
    "API release build",
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "build"],
    { NODE_ENV: "development" },
  );
  await waitForChild(apiBuild, "API release build");
  startService(
    "API release service",
    "node",
    ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
    { NODE_ENV: "development", PORT: String(apiPort) },
  );
  /*
   * Start the dashboard separately from the Project workflow. The release
   * runner owns both process groups and always tears them down in finally.
   */
  startService(
    "Dashboard release service",
    "pnpm",
    ["--filter", "@workspace/dashboard", "run", "dev"],
    { PORT: String(dashboardPort), BASE_PATH: "/dashboard/" },
  );
  await waitFor(apiHealthUrl, "API workflow");
  const dashboardResponse = await waitFor(dashboardBaseUrl, "Dashboard workflow");
  const dashboardHtml = await dashboardResponse.text();
  if (!dashboardHtml.includes("/dashboard/")) {
    throw new Error(
      `Dashboard workflow responded without the /dashboard/ base path (${dashboardBaseUrl}).`,
    );
  }
}

function runClerkHandoffContracts() {
  return new Promise((resolve, reject) => {
    const contractTests = spawn(
      "pnpm",
      ["--filter", "@workspace/dashboard", "run", "test:clerk-handoff"],
      {
        env: {
          ...process.env,
          CI: "true",
        },
        stdio: "inherit",
      },
    );

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start dashboard Clerk handoff contract checks: ${redact(error.message)}`,
        ),
      );
    });

    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(
            `Dashboard Clerk handoff contract checks stopped by ${signal}.`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Dashboard Clerk handoff contract checks failed with exit code ${code ?? 1}; browser startup was skipped.`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

function runDashboardJourneyContracts() {
  return new Promise((resolve, reject) => {
    const contractTests = spawn("pnpm", ["run", "test:dashboard-journey-contract"], {
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    });

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start dashboard journey contract checks: ${redact(error.message)}`,
        ),
      );
    });
    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Dashboard journey contract checks stopped by ${signal}.`));
      } else if (code !== 0) {
        reject(new Error(`Dashboard journey contract checks failed with exit code ${code ?? 1}.`));
      } else {
        resolve();
      }
    });
  });
}

function runMissionCorrelationReportContracts() {
  return new Promise((resolve, reject) => {
    const contractTests = spawn("pnpm", ["run", "test:mission-correlation-report"], {
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    });

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start mission correlation report contract checks: ${redact(error.message)}`,
        ),
      );
    });
    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Mission correlation report contract checks stopped by ${signal}.`));
      } else if (code !== 0) {
        reject(
          new Error(
            `Mission correlation report contract checks failed with exit code ${code ?? 1}.`,
          ),
        );
      } else {
        resolve();
      }
    });
  });
}

function runConcurrentChatContractChecks() {
  const testRuns = [
    {
      file: "src/routes/ai.test.ts",
      pattern: "keeps the newer resumable contract when concurrent JSON turns finish out of order",
    },
    {
      file: "src/routes/ai-stream-integration.test.ts",
      pattern: "keeps the newest resumable contract when same-session turns finish out of order|keeps a streamed forensic cancellation incomplete after recovery retains partial evidence",
    },
  ];

  return testRuns.reduce((chain, testRun) => chain.then(() => new Promise((resolve, reject) => {
    const contractTests = spawn(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "vitest",
        "run",
        testRun.file,
        "-t",
        testRun.pattern,
        "--test-timeout",
        process.env.DASHBOARD_E2E_CONTRACT_TIMEOUT_MS ?? "120000",
      ],
      {
        env: {
          ...process.env,
          CI: "true",
          NODE_ENV: "test",
           GROQ_API_KEY: "",
           GEMINI_API_KEY: "",
           DEEPSEEK_API_KEY: "",
          OPENROUTER_API_KEY: "",
        },
        stdio: "inherit",
      },
    );

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start chat contract checks for ${testRun.file}: ${redact(error.message)}`,
        ),
      );
    });

    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Chat contract checks for ${testRun.file} stopped by ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(
          `Chat contract checks for ${testRun.file} failed with exit code ${code ?? 1}; browser startup was skipped.`,
        ));
        return;
      }
      resolve();
    });
  })), Promise.resolve());
}

function runLiveCorrelationReportCheck() {
  return new Promise((resolve, reject) => {
    const reportPath =
      process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
      "test-results/dashboard-journey/live-mission-correlation.json";
    const check = spawn(
      "node",
      ["scripts/mission-correlation-report.mjs", reportPath],
      { env: { ...process.env }, stdio: "inherit" },
    );
    check.on("error", reject);
    check.on("exit", (code, signal) => {
      if (signal) reject(new Error(`Live mission correlation check stopped by ${signal}.`));
      else if (code !== 0) reject(new Error(`Live mission correlation report failed with exit code ${code ?? 1}.`));
      else resolve();
    });
  });
}

try {
  await runDashboardJourneyContracts();
  console.log("Dashboard journey timeout and provider-mode contracts passed.");
  await runMissionCorrelationReportContracts();
  console.log("Mission correlation report contracts passed.");
  await runClerkHandoffContracts();
  console.log("Dashboard Clerk handoff response contracts passed.");
  if (process.env.DASHBOARD_E2E_SKIP_API_CONTRACTS !== "1") {
    await runConcurrentChatContractChecks();
    console.log("Concurrent chat continuation contracts passed.");
  } else {
    console.log(
      "Skipping duplicate API concurrency contracts; release validation owns the shared database fixture.",
    );
  }
  await startReleaseServices();
  const apiHealth = await (await fetch(apiHealthUrl)).json();
  if (apiHealth?.status !== "ok") {
    throw new Error(`API health check did not report status=ok (${apiHealthUrl}).`);
  }
  console.log(`Dashboard workflow healthy at ${dashboardBaseUrl}`);
  console.log(`API workflow healthy at ${apiHealthUrl}`);
  console.log(`Using isolated Clerk journey user ${testEmail}`);
  const journey = spawn(
    "pnpm",
    ["--filter", "@workspace/dashboard", "run", "test:e2e"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CI: "true",
        DASHBOARD_E2E_BASE_URL: dashboardBaseUrl,
        DASHBOARD_E2E_API_BASE_URL:
          process.env.DASHBOARD_E2E_API_BASE_URL ??
          new URL(apiHealthUrl).origin,
        DASHBOARD_E2E_EMAIL: testEmail,
        DASHBOARD_E2E_EXECUTABLE_PATH: process.env.DASHBOARD_E2E_EXECUTABLE_PATH,
        PLAYWRIGHT_OUTPUT_DIR: outputDir,
        ...(Number.isFinite(liveTimeoutMs) && liveTimeoutMs > 0
          ? { DASHBOARD_E2E_LIVE_TIMEOUT_MS: String(liveTimeoutMs) }
          : {}),
      },
      stdio: "inherit",
    },
  );
  const result = await new Promise((resolveResult, reject) => {
    journey.on("error", reject);
    journey.on("exit", (code, signal) =>
      resolveResult(signal ? 1 : code ?? 1),
    );
  });
  if (result !== 0) process.exitCode = result;
  if (result === 0 && process.env.DASHBOARD_E2E_LIVE_PROVIDER === "1") {
    await runLiveCorrelationReportCheck();
    console.log("Live mission correlation report passed.");
  }
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = process.exitCode || 1;
} finally {
  await stopServices();
  if (releaseLockCleanup) await releaseLockCleanup();
}
