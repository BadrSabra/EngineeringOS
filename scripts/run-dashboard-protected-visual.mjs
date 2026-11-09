#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectLoopbackOnlyNetworkSnapshot,
  readLoopbackOnlyNetworkSnapshot,
} from "./loopback-only-network-namespace.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(
  workspaceRoot,
  "test-results/dashboard-protected-visual",
);
const dashboardPort = Number(
  process.env.DASHBOARD_E2E_PROTECTED_VISUAL_PORT ?? 23186,
);
const dashboardUrl = `http://127.0.0.1:${dashboardPort}/dashboard/`;
const databaseUser = "dashboard_visual_e2e";
const databaseName = "postgres";
const defaultVisualGrep =
  "captures protected dashboard routes at phone, tablet, and desktop sizes";
const testGrep = process.env.DASHBOARD_E2E_GREP?.trim() || defaultVisualGrep;
const isFullVisualRun = testGrep === defaultVisualGrep;
const isUxw01FocusedRun = testGrep === "UXW-01";
const requiresTemporaryPostgres = !isUxw01FocusedRun;

let temporaryRoot = "";
let dataDirectory = "";
let postgresPort = 0;
let postgresStarted = false;
let dashboardProcess;
let stage = "preflight";
let isolationEvidence;

function safeChildEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("PG") ||
      key === "DATABASE_URL" ||
      key.startsWith("CLERK_") ||
      key === "VITE_CLERK_PUBLISHABLE_KEY" ||
      key === "OPENROUTER_API_KEY" ||
      key === "API_PROXY_TARGET" ||
      key === "APP_ORIGINS" ||
      key === "REPLIT_DEV_DOMAIN" ||
      key === "REPLIT_DOMAINS" ||
      key === "NODE_OPTIONS" ||
      /(?:_KEY|_SECRET|_TOKEN|_PASSWORD)$/u.test(key) ||
      key.startsWith("DASHBOARD_E2E_") ||
      key.startsWith("ENGINEERING_AGENT_LIFECYCLE") ||
      key.startsWith("ENGINEERINGOS_RUNTIME_EGRESS")
    ) {
      delete env[key];
    }
  }
  return { ...env, ...extra };
}

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    env: safeChildEnvironment(),
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function runCommand(command, args, { env = safeChildEnvironment(), label }) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: "ignore",
    });
    child.once("error", () =>
      rejectCommand(new Error(`${label} could not start.`)),
    );
    child.once("exit", (code, signal) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${label} failed (${signal ?? code ?? "unknown"}).`));
    });
  });
}

function waitForExit(child, timeoutMs = 5_000) {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit();
      return;
    }
    const timer = setTimeout(resolveExit, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

async function stopOwnedProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await waitForExit(child);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve an isolated PostgreSQL loopback port.");
  }
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

async function verifyLoopbackIsolation() {
  const snapshot = readLoopbackOnlyNetworkSnapshot();
  const isolation = inspectLoopbackOnlyNetworkSnapshot(snapshot);
  if (!isolation.ok) {
    throw new Error(
      `The visual journey is blocked before service startup because OS network isolation is not loopback-only (${isolation.reasons.join(", ")}).`,
    );
  }
  const childProbe = spawnSync(
    process.execPath,
    [
      "-e",
      "process.stdout.write(require('node:fs').readlinkSync('/proc/self/ns/net'))",
    ],
    {
      cwd: workspaceRoot,
      env: safeChildEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const childNamespace = childProbe.status === 0 ? childProbe.stdout.trim() : "";
  if (
    !snapshot.selfNetNamespace ||
    childNamespace !== snapshot.selfNetNamespace
  ) {
    throw new Error(
      "The visual journey is blocked before service startup because child processes do not share the verified loopback-only network namespace.",
    );
  }
  return {
    runnerNamespace: snapshot.selfNetNamespace,
    childNamespace,
    hostNamespace: snapshot.hostNetNamespace,
    interfaces: snapshot.interfaces,
    ipv4Routes: snapshot.ipv4Routes,
    ipv6Routes: snapshot.ipv6Routes,
    isolation,
  };
}

async function verifyBrowserAvailable(browserName) {
  if (browserName === "chromium") {
    const executablePath = process.env.DASHBOARD_E2E_EXECUTABLE_PATH;
    if (!executablePath) {
      throw new Error(
        "Chromium visual journeys require DASHBOARD_E2E_EXECUTABLE_PATH.",
      );
    }
    await access(executablePath);
    return executablePath;
  }
  if (browserName !== "firefox") {
    throw new Error("Choose Firefox or Chromium for the protected visual journey.");
  }
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@workspace/dashboard",
      "exec",
      "node",
      "-e",
      "process.stdout.write(require('@playwright/test').firefox.executablePath())",
    ],
    {
      cwd: workspaceRoot,
      env: safeChildEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const executablePath = result.status === 0 ? result.stdout.trim() : "";
  if (!executablePath) {
    throw new Error("The installed Playwright Firefox browser is unavailable.");
  }
  await access(executablePath);
  return executablePath;
}

async function writePreflightReceipt(outcome, reason, checks = {}) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "preflight.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        outcome,
        stage,
        reason,
        checks,
        servicesStarted: false,
      },
      null,
      2,
    )}\n`,
  );
}

async function waitForDashboard() {
  const deadline = Date.now() + 30_000;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(dashboardUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const html = await response.text();
        if (html.includes("/dashboard/")) return;
        lastError = "dashboard response omitted its artifact base path";
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`The local dashboard did not become ready: ${lastError}.`);
}

async function main() {
  try {
    isolationEvidence = await verifyLoopbackIsolation();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await writePreflightReceipt("blocked", reason, {
      networkNamespace: "unverified",
    });
    console.error(`BLOCKED before any test service: ${reason}`);
    process.exitCode = 2;
    return;
  }

  if (os.userInfo().uid === 0) {
    const reason = "Refusing to run protected browser validation as root.";
    await writePreflightReceipt("blocked", reason, {
      networkNamespace: "verified-loopback-only",
    });
    console.error(`BLOCKED before any test service: ${reason}`);
    process.exitCode = 2;
    return;
  }
  if (
    requiresTemporaryPostgres &&
    !["initdb", "pg_ctl", "psql"].every((command) => commandExists(command))
  ) {
    const reason = "PostgreSQL temporary-cluster tools are unavailable.";
    await writePreflightReceipt("blocked", reason, {
      networkNamespace: "verified-loopback-only",
      disposablePostgres: "unavailable",
    });
    console.error(`BLOCKED before any test service: ${reason}`);
    process.exitCode = 2;
    return;
  }

  const browserName = process.env.DASHBOARD_E2E_BROWSER ?? "firefox";
  try {
    await verifyBrowserAvailable(browserName);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await writePreflightReceipt("blocked", reason, {
      networkNamespace: "verified-loopback-only",
      browser: "unavailable",
    });
    console.error(`BLOCKED before any test service: ${reason}`);
    process.exitCode = 2;
    return;
  }

  try {
    if (requiresTemporaryPostgres) {
      temporaryRoot = await mkdtemp(
        join(os.tmpdir(), "engineeringos-dashboard-protected-visual-"),
      );
      const canonicalTemporaryRoot = await realpath(temporaryRoot);
      if (canonicalTemporaryRoot !== resolve(temporaryRoot)) {
        throw new Error("The temporary PostgreSQL root resolved unexpectedly.");
      }
      dataDirectory = join(temporaryRoot, "postgres-data");
      const socketDirectory = join(temporaryRoot, "postgres-socket");
      await mkdir(socketDirectory, { recursive: true });
      postgresPort = await reserveLoopbackPort();
      const databaseUrl =
        `postgresql://${databaseUser}@127.0.0.1:${postgresPort}/${databaseName}`;

      stage = "temporary-postgres";
      await runCommand(
        "initdb",
        [
          "-D",
          dataDirectory,
          "-U",
          databaseUser,
          "--auth=trust",
          "--no-locale",
          "--encoding=UTF8",
        ],
        { label: "Temporary PostgreSQL initialization" },
      );
      postgresStarted = true;
      await runCommand(
        "pg_ctl",
        [
          "-D",
          dataDirectory,
          "-o",
          `-h 127.0.0.1 -p ${postgresPort} -k ${socketDirectory} -c listen_addresses=127.0.0.1`,
          "-l",
          join(temporaryRoot, "postgres.log"),
          "-w",
          "start",
        ],
        { label: "Temporary PostgreSQL startup" },
      );
      const databaseCheck = spawnSync(
        "psql",
        [
          "--no-psqlrc",
          "--tuples-only",
          "--no-align",
          "--dbname",
          databaseUrl,
          "--command",
          "SELECT current_database() || ':' || current_user",
        ],
        {
          cwd: workspaceRoot,
          env: safeChildEnvironment(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      if (
        databaseCheck.status !== 0 ||
        databaseCheck.stdout.trim() !== `${databaseName}:${databaseUser}`
      ) {
        throw new Error("The runner-owned temporary PostgreSQL check failed.");
      }
    }

    stage = "dashboard-service";
    await mkdir(outputDir, { recursive: true });
    dashboardProcess = spawn(
      "pnpm",
      [
        "--filter",
        "@workspace/dashboard",
        "exec",
        "vite",
        "--config",
        "vite.config.ts",
        "--host",
        "127.0.0.1",
        "--strictPort",
      ],
      {
        cwd: workspaceRoot,
        detached: true,
        env: safeChildEnvironment({
          PORT: String(dashboardPort),
          HOST: "127.0.0.1",
          BASE_PATH: "/dashboard/",
          RUN_CONTROLLED_RELEASE_VALIDATION: "1",
          DASHBOARD_E2E_TEST_MODE: "fixture",
          DASHBOARD_E2E_LOCAL_AUTH_FIXTURE: "1",
          DASHBOARD_E2E_PROTECTED_VISUAL: "1",
        }),
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    dashboardProcess.once("error", () => {
      console.error("The local dashboard process could not start.");
    });
    await waitForDashboard();

    stage = "browser-journey";
    const visualReportPath = join(outputDir, "visual-receipt.json");
    const browserAuditPath = join(outputDir, "browser-egress.json");
    await runCommand(
      "pnpm",
      [
        "--filter",
        "@workspace/dashboard",
        "exec",
        "playwright",
        "test",
        "--config=e2e/playwright.config.ts",
        "--grep",
        testGrep,
      ],
      {
        label: "Protected dashboard visual journey",
        env: safeChildEnvironment({
          CI: "true",
          RUN_CONTROLLED_RELEASE_VALIDATION: "1",
          DASHBOARD_E2E_TEST_MODE: "fixture",
          DASHBOARD_E2E_LOCAL_AUTH_FIXTURE: "1",
          DASHBOARD_E2E_PROTECTED_VISUAL: "1",
          DASHBOARD_E2E_BROWSER: browserName,
          DASHBOARD_E2E_BASE_URL: dashboardUrl,
          DASHBOARD_E2E_GREP: testGrep,
          DASHBOARD_E2E_BROWSER_EGRESS_AUDIT_PATH: browserAuditPath,
          DASHBOARD_E2E_VISUAL_OUTPUT_DIR: outputDir,
          DASHBOARD_E2E_VISUAL_REPORT_PATH: visualReportPath,
          ...(browserName === "chromium"
            ? {
                DASHBOARD_E2E_EXECUTABLE_PATH:
                  process.env.DASHBOARD_E2E_EXECUTABLE_PATH,
              }
            : {}),
          PLAYWRIGHT_OUTPUT_DIR: outputDir,
        }),
      },
    );

    const browserAudit = JSON.parse(await readFile(browserAuditPath, "utf8"));
    if (
      browserAudit?.guard !== "playwright-loopback-only" ||
      browserAudit.externalNetworkAllowed !== false ||
      browserAudit.blockedRequestCount !== 0
    ) {
      throw new Error(
        "The browser egress receipt did not prove that the isolated journey made no external requests.",
      );
    }
    let visualReport = { captures: [] };
    if (isFullVisualRun) {
      visualReport = JSON.parse(await readFile(visualReportPath, "utf8"));
      if (
        visualReport?.outcome !== "passed" ||
        visualReport?.captures?.length !== 32
      ) {
        throw new Error(
          "The visual receipt did not prove 32 clean protected-page captures.",
        );
      }
    }

    await writeFile(
      join(outputDir, "preflight.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          outcome: "passed",
          networkNamespace: isolationEvidence,
          disposablePostgres: requiresTemporaryPostgres
            ? {
                verified: true,
                host: "127.0.0.1",
                ownedTemporaryDataDirectory: true,
                credentialsOrConnectionUrlRecorded: false,
              }
            : {
                verified: false,
                notRequired: true,
                reason:
                  "UXW-01 browser fixtures intercept all API requests; no API or database service starts.",
              },
          apiServiceStarted: false,
          dashboardBoundTo: "127.0.0.1",
          clerkCredentialsPassedToChildren: false,
          apiProxyConfigured: false,
          browserAudit: "browser-egress.json",
          visualReceipt: isFullVisualRun ? "visual-receipt.json" : null,
          screenshots: visualReport.captures.map((capture) => capture.screenshot),
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `Protected visual journey passed; receipts and screenshots are in ${outputDir}.`,
    );
  } finally {
    await stopOwnedProcess(dashboardProcess);
    if (postgresStarted) {
      await runCommand(
        "pg_ctl",
        ["-D", dataDirectory, "-m", "fast", "-w", "stop"],
        { label: "Temporary PostgreSQL shutdown" },
      ).catch(() => {});
    }
    if (temporaryRoot) {
      const canonicalParent = await realpath(dirname(temporaryRoot));
      const canonicalRoot = await realpath(temporaryRoot).catch(() => "");
      if (
        canonicalRoot === resolve(temporaryRoot) &&
        dirname(canonicalRoot) === canonicalParent &&
        canonicalParent === resolve(os.tmpdir())
      ) {
        await rm(canonicalRoot, { recursive: true, force: true });
      }
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Protected visual journey failed at ${stage}: ${message}`);
  process.exitCode = 1;
});
