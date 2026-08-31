#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  acquireReleaseLock,
  lockPath,
  validationLockPath,
} from "../artifacts/api-server/scripts/run-release-ai-stream.mjs";
import {
  formatMissionCorrelationSummary,
  parseMissionCorrelationReportOutput,
} from "./mission-correlation-report.mjs";

if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
  console.error(
    "Dashboard browser journey is release-only; set RUN_CONTROLLED_RELEASE_VALIDATION=1.",
  );
  process.exit(2);
}

const apiPort = Number(process.env.DASHBOARD_E2E_API_PORT ?? 18081);
const dashboardPort = Number(process.env.DASHBOARD_E2E_PORT ?? 23184);
const dashboardBaseUrl =
  process.env.DASHBOARD_E2E_BASE_URL ??
  `http://127.0.0.1:${dashboardPort}/dashboard/`;
const apiHealthUrl =
  process.env.DASHBOARD_E2E_API_HEALTH_URL ??
  `http://127.0.0.1:${apiPort}/api/healthz`;
const apiReadinessUrl =
  process.env.DASHBOARD_E2E_API_READINESS_URL ??
  `http://127.0.0.1:${apiPort}/api/readiness`;
// Origin contract probes must reach the API listener directly. Sending them
// through the dashboard dev proxy lets some browser environments terminate
// OPTIONS locally with a bare 204, which hides the API's CORS response.
const apiBaseUrl =
  process.env.DASHBOARD_E2E_API_BASE_URL ??
  `http://127.0.0.1:${apiPort}/`;
const testEmail =
  process.env.DASHBOARD_E2E_EMAIL ??
  "engineeringos-dashboard-release@example.com";
const timeoutMs = Number(
  process.env.DASHBOARD_E2E_PREFLIGHT_TIMEOUT_MS ?? 30_000,
);
const readinessTimeoutMs = Number(
  process.env.DASHBOARD_E2E_READINESS_TIMEOUT_MS ?? 15_000,
);
const restartTimeoutMs = Number(
  process.env.DASHBOARD_E2E_RESTART_TIMEOUT_MS ?? 30_000,
);
const dashboardTestMode =
  process.env.DASHBOARD_E2E_TEST_MODE ??
  (process.env.DASHBOARD_E2E_LIVE_PROVIDER === "1"
    ? "live-provider"
    : "fixture");
let groqCatalogFixtureMode =
  process.env.DASHBOARD_E2E_GROQ_CATALOG_FIXTURE_MODE ?? "healthy";
const groqCatalogFixtureEnabled = dashboardTestMode === "fixture";
const dashboardFixtureProjectId =
  process.env.DASHBOARD_E2E_LIVE_PROJECT_ID ?? "e2e-project";
const liveTimeoutMs = Number(
  process.env.DASHBOARD_E2E_LIVE_TIMEOUT_MS ?? 120_000,
);
const childTimeoutMs = Number(
  process.env.DASHBOARD_E2E_CHILD_TIMEOUT_MS ?? 600_000,
);
const approvedDashboardOrigins = (process.env.APP_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (
  approvedDashboardOrigins.length === 0 &&
  process.env.DASHBOARD_E2E_TEARDOWN_FIXTURE === "1"
) {
  approvedDashboardOrigins.push(`http://127.0.0.1:${dashboardPort}`);
}
if (approvedDashboardOrigins.length === 0) {
  throw new Error(
    "APP_ORIGINS must contain every approved dashboard origin for the release journey.",
  );
}
const workspaceRoot = resolve(new URL("..", import.meta.url).pathname);
const outputDir = resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/dashboard-journey",
);
const teardownArtifactPath = resolve(
  process.env.DASHBOARD_E2E_TEARDOWN_ARTIFACT_PATH ??
    resolve(outputDir, "release-teardown.json"),
);
const originDiagnosticsPath = resolve(
  process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH ??
    resolve(outputDir, "origin-diagnostics.json"),
);
const groqCatalogEvidencePath = resolve(
  process.env.DASHBOARD_E2E_GROQ_CATALOG_ARTIFACT_PATH ??
    resolve(outputDir, "groq-catalog-recovery.json"),
);
const services = [];
let releaseLockCleanup;
let validationLockCleanup;
const releasePorts = [apiPort, dashboardPort];
const controlPort = Number(
  process.env.DASHBOARD_E2E_CONTROL_PORT ?? apiPort + 1,
);
let apiService;
let campaignControlServer;

function groqCatalogFixtureEnvironment() {
  return groqCatalogFixtureEnabled
    ? {
        // This value is accepted only by the controlled startup fixture and
        // is never sent to an external provider.
        GROQ_API_KEY: "controlled-release-fixture-key",
        GROQ_CATALOG_FIXTURE_MODE: groqCatalogFixtureMode,
      }
    : {};
}

function redact(value) {
  const secretValues = Object.values(process.env).filter(
    (item) => typeof item === "string" && item.length >= 8,
  );
  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
    value,
  );
}

async function waitFor(url, label, budgetMs = timeoutMs) {
  const deadline = Date.now() + budgetMs;
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

async function writeBlockedReadinessReceipt(reason, checks = {}) {
  const receiptPath = resolve(
    process.env.DASHBOARD_E2E_READINESS_ARTIFACT_PATH ??
      resolve(outputDir, "readiness.json"),
  );
  const receipt = {
    outcome: "blocked",
    reason: redact(String(reason)).replaceAll(workspaceRoot, "[PROJECT_ROOT]"),
    checks,
    mode: dashboardTestMode,
    project: dashboardFixtureProjectId,
  };
  await mkdir(resolve(receiptPath, ".."), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.error(`BLOCKED readiness receipt: ${receiptPath}`);
}

async function performReleaseReadinessHandshake() {
  const checks = {};
  const modeReady =
    dashboardTestMode === "fixture" || dashboardTestMode === "live-provider";
  checks.mode = {
    status: modeReady ? "ready" : "blocked",
    ...(modeReady ? {} : { reason: "unsupported_test_mode" }),
  };
  if (dashboardTestMode === "live-provider") {
    checks.provider = {
      status:
        process.env.DASHBOARD_E2E_LIVE_PROVIDER === "1" ? "ready" : "blocked",
      ...(process.env.DASHBOARD_E2E_LIVE_PROVIDER === "1"
        ? {}
        : { reason: "live_provider_not_enabled" }),
    };
    checks.disposableProject = {
      status:
        process.env.DASHBOARD_E2E_LIVE_DISPOSABLE === "1" &&
        Boolean(process.env.DASHBOARD_E2E_LIVE_PROJECT_ID)
          ? "ready"
          : "blocked",
      ...(process.env.DASHBOARD_E2E_LIVE_DISPOSABLE === "1" &&
      process.env.DASHBOARD_E2E_LIVE_PROJECT_ID
        ? {}
        : { reason: "disposable_project_required" }),
    };
  } else {
    checks.provider = { status: "ready", reason: "provider_free_fixture" };
    checks.disposableProject = {
      status: "ready",
      reason: "browser_fixture_project",
    };
  }
  if (
    !modeReady ||
    Object.values(checks).some((check) => check.status !== "ready")
  ) {
    await writeBlockedReadinessReceipt(
      "selected test mode is not allowed",
      checks,
    );
    throw new Error(
      "BLOCKED: release readiness handshake rejected the selected test mode.",
    );
  }

  const deadline = Date.now() + readinessTimeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(apiReadinessUrl, {
        signal: AbortSignal.timeout(Math.min(5_000, readinessTimeoutMs)),
      });
      const body = await response.json().catch(() => ({}));
      checks.api = { status: response.ok ? "ready" : "blocked" };
      checks.database = body?.checks?.database ?? { status: "blocked" };
      checks.schema = body?.checks?.schema ?? { status: "blocked" };
      if (
        response.ok &&
        body?.status === "ready" &&
        checks.database.status === "ready" &&
        checks.schema.status === "ready"
      ) {
        checks.auth = { status: "pending_browser_session" };
        checks.fixtureProject = {
          status: "pending_authenticated_browser_check",
          project: dashboardFixtureProjectId,
        };
        return checks;
      }
      lastError = "api, database, or schema not ready";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await writeBlockedReadinessReceipt(lastError, checks);
  throw new Error(
    "BLOCKED: API/database/schema readiness handshake did not complete.",
  );
}

function startService(label, command, args, env, port) {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
    detached: true,
  });
  services.push({ label, child, port });
  child.on("error", (error) => {
    console.error(`${label} could not start: ${redact(error.message)}`);
  });
  return child;
}

async function restartApiService() {
  if (!apiService) throw new Error("API release service is not running.");
  const previousApiService = apiService;
  signalProcessGroup(apiService, "SIGTERM");
  await waitForPortClosed(apiPort, restartTimeoutMs);
  await waitForProcessGroupClosed(previousApiService, restartTimeoutMs);
  apiService = startService(
    "API release service (restarted)",
    "node",
    ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
    {
      NODE_ENV: "development",
      PORT: String(apiPort),
      APP_ORIGINS: approvedDashboardOrigins.join(","),
      ...groqCatalogFixtureEnvironment(),
    },
    apiPort,
  );
  await waitFor(apiHealthUrl, "restarted API workflow", restartTimeoutMs);
  await performReleaseReadinessHandshake();
}

async function startCampaignControl() {
  campaignControlServer = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      request.method === "POST" &&
      requestUrl.pathname === "/groq-catalog-fixture"
    ) {
      const mode = requestUrl.searchParams.get("mode");
      if (!groqCatalogFixtureEnabled || !["timeout", "healthy", "retired"].includes(mode)) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unsupported Groq catalog fixture mode" }));
        return;
      }
      groqCatalogFixtureMode = mode;
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "POST" || requestUrl.pathname !== "/restart-api") {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      await restartApiService();
      response.writeHead(204);
      response.end();
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: redact(error instanceof Error ? error.message : String(error)),
        }),
      );
    }
  });
  await new Promise((resolve, reject) => {
    campaignControlServer.once("error", reject);
    campaignControlServer.listen(controlPort, "127.0.0.1", resolve);
  });
}

function listeningUsers(port) {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return [
      ...new Set(
        [...output.matchAll(/\b\d+\b/g)].map((match) => Number(match[0])),
      ),
    ];
  } catch {
    return [];
  }
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitForPortClosed(port, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listeningUsers(port).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const remainingPids = listeningUsers(port);
  const error = new Error(
    `Release port ${port} did not become available; surviving process IDs: ${
      remainingPids.length > 0 ? remainingPids.join(", ") : "unknown"
    }.`,
  );
  error.remainingPids = remainingPids;
  throw error;
}

async function waitForProcessGroupClosed(child, timeoutMs = 5_000) {
  if (!child.pid) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-child.pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Release process group ${child.pid} did not exit within its bounded restart deadline.`,
  );
}

async function waitForPortOpen(port, timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listeningUsers(port).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Teardown fixture did not open port ${port}.`);
}

async function ensureReleasePortFree(port) {
  for (const pid of listeningUsers(port).filter(
    (item) => item !== process.pid,
  )) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  try {
    await waitForPortClosed(port, 2_500);
    return;
  } catch {
    for (const pid of listeningUsers(port).filter(
      (item) => item !== process.pid,
    )) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await waitForPortClosed(port);
  }
}

async function ensureReleasePortsFree() {
  for (const port of releasePorts) await ensureReleasePortFree(port);
}

function releaseServiceForPort(port) {
  if (port === apiPort) return "API release service";
  if (port === dashboardPort) return "Dashboard release service";
  return `Release service on port ${port}`;
}

async function waitForChild(child, label) {
  const result = await new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => {
      try {
        signalProcessGroup(child, "SIGTERM");
        setTimeout(() => signalProcessGroup(child, "SIGKILL"), 5_000).unref();
      } catch (error) {
        reject(error);
        return;
      }
      reject(new Error(`${label} exceeded the ${childTimeoutMs}ms timeout.`));
    }, childTimeoutMs);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code: code ?? 1, signal });
    });
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
  if (campaignControlServer) {
    await new Promise((resolve) => campaignControlServer.close(resolve));
    campaignControlServer = undefined;
  }
  for (const { child } of services) {
    try {
      signalProcessGroup(child, "SIGTERM");
    } catch (error) {
      console.error(redact(String(error)));
    }
  }
  const teardownResults = await Promise.all(
    services.map(
      ({ child }) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) {
            return resolve({
              code: child.exitCode,
              signal: null,
              forced: false,
            });
          }
          const timer = setTimeout(() => {
            try {
              signalProcessGroup(child, "SIGKILL");
            } catch (error) {
              console.error(redact(String(error)));
            }
            resolve({
              code: child.exitCode,
              signal: "SIGKILL",
              forced: true,
            });
          }, 5_000);
          child.once("exit", (code, signal) => {
            clearTimeout(timer);
            resolve({
              code: code ?? null,
              signal: signal ?? null,
              forced: false,
            });
          });
        }),
    ),
  );
  console.log("Release service teardown results:");
  services.forEach(({ label }, index) => {
    const result = teardownResults[index];
    const status = result.forced
      ? "forced SIGKILL"
      : result.signal
        ? `signal ${result.signal}`
        : `exit ${result.code ?? "unknown"}`;
    console.log(`- ${label}: ${status}`);
  });
  const survivingServices = services.flatMap(({ label, port, child }) => {
    if (!port) return [];
    const pids = listeningUsers(port);
    return pids.length > 0
      ? [{ label, port, pids, processGroup: child.pid ?? null }]
      : [];
  });
  if (survivingServices.length === 0) {
    console.log("Release services surviving teardown: none.");
  } else {
    console.error(
      `Release services surviving teardown: ${survivingServices
        .map(
          ({ label, port, pids }) =>
            `${label} (configured release port ${port}; surviving process IDs: ${pids.join(
              ", ",
            )}; release process group: ${
              services.find((service) => service.label === label)?.child.pid ??
              "unknown"
            })`,
        )
        .join("; ")}`,
    );
  }

  let teardownFailed = false;
  const cleanupFailures = new Map();
  for (const port of releasePorts) {
    try {
      await ensureReleasePortFree(port);
    } catch (error) {
      const service = services.find((item) => item.port === port);
      const remainingPids =
        error?.remainingPids?.length > 0
          ? error.remainingPids
          : listeningUsers(port);
      const diagnostic = [
        `${service?.label ?? `Release service on port ${port}`} teardown failed`,
        `(configured release port ${port})`,
        `surviving process IDs: ${
          remainingPids.length > 0 ? remainingPids.join(", ") : "unknown"
        }`,
        `release process group: ${service?.child.pid ?? "unknown"}`,
      ].join("; ");
      console.error(
        redact(`${diagnostic}. ${error?.message ?? String(error)}`),
      );
      teardownFailed = true;
      cleanupFailures.set(port, {
        message: redact(error?.message ?? String(error)),
        survivingPids: remainingPids,
      });
    }
  }
  const originDiagnostics = await readOriginDiagnostics();
  const teardownArtifact = {
    outcome: teardownFailed ? "failed" : "passed",
    ...originDiagnostics,
    ...(groqCatalogFixtureEnabled
      ? { groqCatalogEvidence: groqCatalogEvidencePath }
      : {}),
    services: services.map(({ label, child, port }, index) => {
      const lifecycle = teardownResults[index];
      const survivor = survivingServices.find((item) => item.port === port);
      const failure = port ? cleanupFailures.get(port) : undefined;
      return {
        owningService: label,
        configuredPort: port ?? null,
        survivingPids: survivor?.pids ?? failure?.survivingPids ?? [],
        processGroup: child.pid ?? null,
        cleanupOutcome: failure
          ? "failed"
          : lifecycle.forced
            ? "forced"
            : "passed",
        exitCode: lifecycle.code,
        signal: lifecycle.signal,
        forced: lifecycle.forced,
        finalSurvivingPids: port ? listeningUsers(port) : [],
        ...(failure ? { error: failure.message } : {}),
      };
    }),
  };
  if (originDiagnostics.originDiagnostics?.length) {
    console.log("Release origin diagnostics:");
    for (const diagnostic of originDiagnostics.originDiagnostics) {
      console.log(
        `- ${JSON.stringify({
          origin: diagnostic.origin,
          phase: diagnostic.phase,
          ...(diagnostic.status === undefined
            ? {}
            : { status: diagnostic.status }),
          ...(diagnostic.headers ? { headers: diagnostic.headers } : {}),
          ...(diagnostic.error ? { error: diagnostic.error } : {}),
        })}`,
      );
    }
  }
  try {
    await mkdir(resolve(teardownArtifactPath, ".."), { recursive: true });
    await writeFile(
      teardownArtifactPath,
      `${JSON.stringify(teardownArtifact, null, 2)}\n`,
      "utf8",
    );
    console.log(`Release teardown artifact: ${teardownArtifactPath}`);
    console.log(
      `Release teardown evidence summary: validation run ${
        process.env.GITHUB_RUN_ID ?? "local"
      }; retained artifact ${teardownArtifactPath}.`,
    );
    console.log(
      `Release teardown evidence coverage: ${teardownArtifact.services
        .map(
          (service) =>
            `${service.owningService} (process group ${
              service.processGroup ?? "unknown"
            }; descendants tracked by surviving PIDs)`,
        )
        .join("; ")}.`,
    );
  } catch (error) {
    console.error(
      redact(
        `Unable to write release teardown artifact ${teardownArtifactPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
    teardownFailed = true;
  }
  if (teardownFailed) process.exitCode = process.exitCode || 1;
}

async function readOriginDiagnostics() {
  try {
    const parsed = JSON.parse(await readFile(originDiagnosticsPath, "utf8"));
    if (
      !parsed ||
      !Array.isArray(parsed.diagnostics) ||
      parsed.diagnostics.some(
        (item) =>
          !item ||
          typeof item.origin !== "string" ||
          typeof item.phase !== "string" ||
          Object.keys(item).some(
            (key) => !["origin", "phase", "status", "headers", "error"].includes(key),
          )
        )
    ) {
      throw new Error("invalid origin diagnostics");
    }
    return { originDiagnostics: parsed.diagnostics };
  } catch {
    return {};
  }
}

async function startReleaseServices() {
  if (process.env.DATABASE_URL) {
    validationLockCleanup = await acquireReleaseLock(validationLockPath);
    releaseLockCleanup = await acquireReleaseLock(lockPath);
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(originDiagnosticsPath, '{"diagnostics":[]}\n', "utf8");
  if (process.env.DASHBOARD_E2E_TEARDOWN_FIXTURE === "1") {
    const descendantScript = [
      "const { spawn } = require('node:child_process');",
      "const listener = spawn(process.execPath, ['-e',",
      "  \"require('node:net').createServer().listen(Number(process.argv[1]), '127.0.0.1')\",",
      "  process.env.PORT], { detached: true, stdio: 'ignore' });",
      "listener.unref();",
      "process.on('SIGTERM', () => {});",
      "setInterval(() => {}, 1_000);",
    ].join(" ");
    startService(
      "API release service",
      process.execPath,
      ["-e", descendantScript],
      { PORT: String(apiPort) },
      apiPort,
    );
    await waitForPortOpen(apiPort);
    return;
  }
  const chromium = process.env.DASHBOARD_E2E_EXECUTABLE_PATH;
  if (!chromium) {
    throw new Error(
      "release-dashboard-journey requires DASHBOARD_E2E_EXECUTABLE_PATH; configure Chromium before starting services.",
    );
  }
  await ensureReleasePortsFree();
  const apiBuild = startService(
    "API release build",
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "build"],
    { NODE_ENV: "development" },
  );
  await waitForChild(apiBuild, "API release build");
  apiService = startService(
    "API release service",
    "node",
    ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
    {
      NODE_ENV: "development",
      PORT: String(apiPort),
      APP_ORIGINS: approvedDashboardOrigins.join(","),
      ...groqCatalogFixtureEnvironment(),
    },
    apiPort,
  );
  /*
   * Start the dashboard separately from the Project workflow. The release
   * runner owns both process groups and always tears them down in finally.
   */
  startService(
    "Dashboard release service",
    "pnpm",
    ["--filter", "@workspace/dashboard", "run", "dev"],
    {
      PORT: String(dashboardPort),
      BASE_PATH: "/dashboard/",
      API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
    },
    dashboardPort,
  );
  await waitFor(apiHealthUrl, "API workflow");
  await startCampaignControl();
  const dashboardResponse = await waitFor(
    dashboardBaseUrl,
    "Dashboard workflow",
  );
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
    const contractTests = spawn(
      "pnpm",
      ["run", "test:dashboard-journey-contract"],
      {
        env: { ...process.env, CI: "true" },
        stdio: "inherit",
      },
    );

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start dashboard journey contract checks: ${redact(error.message)}`,
        ),
      );
    });
    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(`Dashboard journey contract checks stopped by ${signal}.`),
        );
      } else if (code !== 0) {
        reject(
          new Error(
            `Dashboard journey contract checks failed with exit code ${code ?? 1}.`,
          ),
        );
      } else {
        resolve();
      }
    });
  });
}

function runMissionCorrelationReportContracts() {
  return new Promise((resolve, reject) => {
    const contractTests = spawn(
      "pnpm",
      ["run", "test:mission-correlation-report"],
      {
        env: { ...process.env, CI: "true" },
        stdio: "inherit",
      },
    );

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start mission correlation report contract checks: ${redact(error.message)}`,
        ),
      );
    });
    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(
            `Mission correlation report contract checks stopped by ${signal}.`,
          ),
        );
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
      pattern:
        "keeps the newer resumable contract when concurrent JSON turns finish out of order",
    },
    {
      file: "src/routes/ai-stream-integration.test.ts",
      pattern:
        "keeps the newest resumable contract when same-session turns finish out of order|keeps a streamed forensic cancellation incomplete after recovery retains partial evidence",
    },
  ];

  return testRuns.reduce(
    (chain, testRun) =>
      chain.then(
        () =>
          new Promise((resolve, reject) => {
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
                reject(
                  new Error(
                    `Chat contract checks for ${testRun.file} stopped by ${signal}.`,
                  ),
                );
                return;
              }
              if (code !== 0) {
                reject(
                  new Error(
                    `Chat contract checks for ${testRun.file} failed with exit code ${code ?? 1}; browser startup was skipped.`,
                  ),
                );
                return;
              }
              resolve();
            });
          }),
      ),
    Promise.resolve(),
  );
}

function runLiveCorrelationReportCheck() {
  return new Promise((resolveReport, reject) => {
    const reportPath = resolve(
      workspaceRoot,
      process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
        "test-results/dashboard-journey/live-mission-correlation.json",
    );
    const check = spawn(
      "node",
      ["scripts/mission-correlation-report.mjs", reportPath],
      {
        env: {
          ...process.env,
           MISSION_CORRELATION_REQUIRE_EVIDENCE: "1",
          MISSION_CORRELATION_REQUIRE_CANDIDATE: "1",
        },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let output = "";
    check.stdout.on("data", (chunk) => {
      output += chunk;
    });
    check.on("error", reject);
    check.on("close", (code, signal) => {
      if (signal)
        reject(
          new Error(`Live mission correlation check stopped by ${signal}.`),
        );
      else if (code !== 0)
        reject(
          new Error(
            `Live mission correlation report failed with exit code ${code ?? 1}.`,
          ),
        );
      else {
        try {
          const report = parseMissionCorrelationReportOutput(output);
          console.log(formatMissionCorrelationSummary(report));
           resolveReport(report);
        } catch (error) {
          reject(
            new Error(
              `Live mission correlation report produced invalid output: ${
                error instanceof Error ? error.message : String(error)
              }.`,
            ),
          );
        }
      }
    });
  });
}

try {
  if (process.env.DASHBOARD_E2E_TEARDOWN_FIXTURE === "1") {
    await startReleaseServices();
  } else {
    await runDashboardJourneyContracts();
    console.log(
      "Dashboard journey timeout and provider-mode contracts passed.",
    );
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
    await performReleaseReadinessHandshake();
    console.log(`Dashboard workflow healthy at ${dashboardBaseUrl}`);
    console.log(`API workflow healthy at ${apiHealthUrl}`);
    console.log(`Using isolated Clerk journey user ${testEmail}`);
    const journey = spawn(
      "pnpm",
      [
        "--filter",
        "@workspace/dashboard",
        "exec",
        "playwright",
        "test",
        "--config=e2e/playwright.config.ts",
        ...(process.env.DASHBOARD_E2E_GREP
          ? ["--grep", process.env.DASHBOARD_E2E_GREP]
          : []),
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          CI: "true",
          DASHBOARD_E2E_BASE_URL: dashboardBaseUrl,
          DASHBOARD_E2E_API_BASE_URL: apiBaseUrl,
          DASHBOARD_E2E_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
          DASHBOARD_E2E_TEST_MODE: dashboardTestMode,
          DASHBOARD_E2E_GROQ_CATALOG_FIXTURE: groqCatalogFixtureEnabled
            ? "1"
            : "0",
          DASHBOARD_E2E_READINESS_TIMEOUT_MS: String(readinessTimeoutMs),
          DASHBOARD_E2E_READINESS_ARTIFACT_PATH: resolve(
            outputDir,
            "readiness.json",
          ),
          DASHBOARD_E2E_LIVE_PROJECT_ID: dashboardFixtureProjectId,
          DASHBOARD_E2E_EMAIL: testEmail,
          DASHBOARD_E2E_APPROVED_ORIGINS: approvedDashboardOrigins.join(","),
          DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH: originDiagnosticsPath,
          DASHBOARD_E2E_GROQ_CATALOG_ARTIFACT_PATH: groqCatalogEvidencePath,
          DASHBOARD_E2E_EXECUTABLE_PATH:
            process.env.DASHBOARD_E2E_EXECUTABLE_PATH,
          PLAYWRIGHT_OUTPUT_DIR: outputDir,
          DASHBOARD_E2E_LIVE_REPORT_PATH: resolve(
            workspaceRoot,
            process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
              "test-results/dashboard-journey/live-mission-correlation.json",
          ),
          ...(Number.isFinite(liveTimeoutMs) && liveTimeoutMs > 0
            ? { DASHBOARD_E2E_LIVE_TIMEOUT_MS: String(liveTimeoutMs) }
            : {}),
        },
        stdio: "inherit",
      },
    );
    const result = await new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        signalProcessGroup(journey, "SIGTERM");
        setTimeout(() => signalProcessGroup(journey, "SIGKILL"), 5_000).unref();
        reject(new Error(`Dashboard browser journey exceeded the ${childTimeoutMs}ms timeout.`));
      }, childTimeoutMs);
      journey.on("error", reject);
      journey.on("exit", (code, signal) =>
        (clearTimeout(timer), resolveResult(signal ? 1 : (code ?? 1))),
      );
    });
    if (result !== 0) process.exitCode = result;
    if (
      result === 0 &&
      process.env.DASHBOARD_E2E_LIVE_PROVIDER === "1"
    ) {
      await runLiveCorrelationReportCheck();
    }
  }
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = process.exitCode || 1;
} finally {
  await stopServices();
  if (releaseLockCleanup) await releaseLockCleanup();
  if (validationLockCleanup) await validationLockCleanup();
}
