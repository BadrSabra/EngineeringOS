#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  constants as fsConstants,
  createWriteStream,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { createServer } from "node:net";
import { request as makeHttpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runApiOnlySmoke } from "./api-only-smoke.mjs";
import {
  inspectLoopbackOnlyNetworkSnapshot,
  readLoopbackOnlyNetworkSnapshot,
} from "./loopback-only-network-namespace.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const apiRoot = path.join(workspaceRoot, "artifacts/api-server");
const apiBuildScript = path.join(apiRoot, "build.mjs");
const apiEntrypoint = path.join(apiRoot, "dist/index.mjs");
const egressGuardPath = path.join(workspaceRoot, "scripts/runtime-egress-guard.mjs");
const resultsParent = path.join(workspaceRoot, "test-results/api-only-smoke");
const forbiddenPorts = new Set([8099, 23_183, 23_184]);
const databaseUser = "engineeringos_api_smoke";
const databaseName = "engineeringos_api_smoke";
const expectedEntityTables = [
  "projects",
  "ai_chat_sessions",
  "ai_chat_messages",
  "ai_mission_handoffs",
  "ai_missions",
  "ai_goals",
  "ai_executions",
  "ai_execution_acceptances",
  "ai_execution_evidence_snapshots",
  "ai_execution_evidence_reads",
  "ai_goal_dependencies",
  "ai_agent_episodes",
  "ai_agent_episode_events",
  "tasks",
  "task_logs",
  "workflow_executions",
  "ai_change_proposals",
  "ai_mission_lineages",
];
const expectedApiBuildScript = "node ./build.mjs";
const expectedApiStartScript = "node --enable-source-maps ./dist/index.mjs";
const expectedSchemaApplyScript =
  "drizzle-kit push --config ./drizzle.config.ts && tsx ./src/check-schema.ts";
const commandTimeoutMs = 120_000;
const apiStartupTimeoutMs = 25_000;
const apiStopTimeoutMs = 6_000;
const maxCommandOutputBytes = 2 * 1024 * 1024;
const maxApiOutputBytes = 2 * 1024 * 1024;

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function redact(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/giu, "[database-url-redacted]")
    .replace(/(?:OPENROUTER|CLERK|SESSION)_SECRET_KEY\s*[:=]\s*\S+/giu, "[secret-redacted]")
    .slice(0, maxCommandOutputBytes);
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function minimalEnvironment({ home, tempDir, databaseUrl } = {}) {
  const env = {
    CI: "1",
    COREPACK_ENABLE_NETWORK: "0",
    npm_config_offline: "true",
    PNPM_OFFLINE: "1",
    NODE_OPTIONS: "",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home ?? os.homedir(),
    TMPDIR: tempDir ?? os.tmpdir(),
    TEMP: tempDir ?? os.tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    TZ: "UTC",
  };
  if (databaseUrl) {
    env.DATABASE_URL = databaseUrl;
    env.PGSSLMODE = "disable";
  }
  return env;
}

async function resolveExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate, fsConstants.X_OK);
      const resolved = await realpath(candidate);
      const info = await stat(resolved);
      if (info.isFile()) return resolved;
    } catch {
      // Search the remaining PATH entries.
    }
  }
  throw new Error(`required_executable_not_found:${name}`);
}

async function reserveLoopbackPort(heldPorts) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const port = randomInt(28_000, 45_001);
    if (forbiddenPorts.has(port) || heldPorts.has(port)) continue;
    const server = createServer();
    const result = await new Promise((resolveResult) => {
      const onError = (error) => resolveResult({ error });
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolveResult({ address: server.address() });
      });
    });
    if (result.error) continue;
    if (!result.address || typeof result.address === "string") {
      await new Promise((resolveClose) => server.close(resolveClose));
      continue;
    }
    heldPorts.add(port);
    let released = false;
    return {
      port,
      release: async () => {
        if (released) return;
        released = true;
        await new Promise((resolveClose, rejectClose) => {
          server.close((error) => error ? rejectClose(error) : resolveClose());
        });
      },
    };
  }
  throw new Error("no_safe_loopback_port_available");
}

function parseCapabilities() {
  let status;
  try {
    status = readFileSync("/proc/self/status", "utf8");
  } catch {
    throw new Error("process_capabilities_unverifiable");
  }
  const values = Object.fromEntries(
    [...status.matchAll(/^(CapEff|CapPrm|CapBnd):\s*([a-f0-9]+)$/gimu)]
      .map((match) => [match[1], BigInt(`0x${match[2]}`)]),
  );
  if (
    values.CapEff === undefined
    || values.CapPrm === undefined
    || values.CapBnd === undefined
  ) {
    throw new Error("process_capabilities_unverifiable");
  }
  const forbidden = (1n << 12n) | (1n << 21n); // CAP_NET_ADMIN | CAP_SYS_ADMIN
  for (const name of ["CapEff", "CapPrm", "CapBnd"]) {
    if ((values[name] & forbidden) !== 0n) {
      throw new Error(`network_namespace_mutation_capability_present:${name}`);
    }
  }
  return {
    effective: values.CapEff.toString(16),
    permitted: values.CapPrm.toString(16),
    bounding: values.CapBnd.toString(16),
    networkAdminAndSystemAdminAbsent: true,
  };
}

function assertChildNamespace(expectedNamespace) {
  const source =
    "process.stdout.write(require('node:fs').readlinkSync('/proc/self/ns/net'))";
  const child = spawnSync(process.execPath, ["-e", source], {
    cwd: workspaceRoot,
    env: minimalEnvironment(),
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 4_096,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    throw new Error("network_namespace_child_inheritance_unverified");
  }
  const childNamespace = child.stdout.trim();
  if (!childNamespace || childNamespace !== expectedNamespace) {
    throw new Error("child_network_namespace_differs_from_runner");
  }
  return childNamespace;
}

async function hashSourceTree() {
  const hash = createHash("sha256");
  const roots = [
    "scripts/api-only-smoke.mjs",
    "scripts/run-api-only-smoke.mjs",
    "scripts/api-only-smoke-container-preflight.mjs",
    "scripts/run-api-only-smoke-container.sh",
    "scripts/loopback-only-network-namespace.mjs",
    "scripts/runtime-egress-guard.mjs",
    "scripts/isolated-child-process-policy.mjs",
    "artifacts/api-server/src",
    "artifacts/api-server/build.mjs",
    "artifacts/api-server/package.json",
    "lib/db/src",
    "lib/db/drizzle.config.ts",
    "lib/db/package.json",
    "lib/api-zod/src",
    "lib/api-zod/package.json",
    "lib/ai-orchestrator/src",
    "lib/ai-orchestrator/package.json",
    "lib/knowledge-engine/src",
    "lib/knowledge-engine/package.json",
    "lib/scanner/src",
    "lib/scanner/package.json",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
  ];
  async function visit(absolutePath, relativePath) {
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      throw new Error(`source_tree_contains_symlink:${relativePath}`);
    }
    if (info.isDirectory()) {
      const entries = (await readdir(absolutePath)).sort();
      for (const entry of entries) {
        await visit(path.join(absolutePath, entry), path.join(relativePath, entry));
      }
      return;
    }
    if (!info.isFile()) return;
    hash.update(relativePath.replaceAll(path.sep, "/"));
    hash.update("\0");
    hash.update(await readFile(absolutePath));
    hash.update("\0");
  }
  for (const relativePath of roots) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    await visit(absolutePath, relativePath);
  }
  return hash.digest("hex");
}

async function requireNoExistingApiDist() {
  try {
    await lstat(path.join(apiRoot, "dist"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("api_dist_must_be_absent_in_disposable_checkout");
}

export function createApiSmokeEnvironment({
  databaseUrl,
  databasePort,
  port,
  auditPath,
  workerScopeProjectId,
  home,
  tempDir,
}) {
  const databaseTarget = new URL(databaseUrl);
  if (
    databaseTarget.protocol !== "postgresql:"
    || databaseTarget.hostname !== "127.0.0.1"
    || databaseTarget.pathname !== `/${databaseName}`
    || databaseTarget.username !== databaseUser
    || Boolean(databaseTarget.password)
    || databaseTarget.searchParams.get("sslmode") !== "disable"
    || [...databaseTarget.searchParams.keys()].some((key) => key !== "sslmode")
    || databaseTarget.port !== String(databasePort)
    || !Number.isInteger(databasePort)
    || databasePort < 28_000
    || databasePort > 45_000
    || forbiddenPorts.has(databasePort)
    || !Number.isInteger(port)
    || port < 28_000
    || port > 45_000
    || forbiddenPorts.has(port)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(workerScopeProjectId)
  ) {
    throw new Error("api_smoke_environment_scope_invalid");
  }
  return {
    ...minimalEnvironment({ home, tempDir, databaseUrl }),
    NODE_ENV: "test",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    APP_ORIGINS: `http://127.0.0.1:${port}`,
    RUN_CONTROLLED_RELEASE_VALIDATION: "1",
    ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
    DASHBOARD_E2E_TEST_MODE: "fixture",
    ENGINEERINGOS_LOCAL_E2E_AUTH_FIXTURE: "1",
    ENGINEERING_AGENT_WORKER_SCOPE_PROJECT_ID: workerScopeProjectId,
    AI_PROVIDER_EGRESS_DISABLED: "1",
    ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE: "blocked",
    ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON: "[]",
    ENGINEERINGOS_RUNTIME_EGRESS_AUDIT_PATH: auditPath,
  };
}

async function writeLog(logPath, stdout, stderr) {
  await writeFile(
    logPath,
    [
      stdout ? `--- stdout ---\n${stdout}` : "",
      stderr ? `--- stderr ---\n${stderr}` : "",
    ].filter(Boolean).join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
}

function runCommand(command, args, {
  cwd,
  env,
  timeoutMs = commandTimeoutMs,
  logPath,
  allowNonzero = false,
  outputLimitBytes = maxCommandOutputBytes,
} = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let settled = false;
    let forceKillTimer;
    const append = (target, chunk) => {
      const text = chunk.toString("utf8");
      outputBytes += Buffer.byteLength(text);
      if (outputBytes <= outputLimitBytes) {
        if (target === "stdout") stdout += text;
        else stderr += text;
      } else {
        outputExceeded = true;
        try {
          signalGroup(child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        forceKillTimer ??= setTimeout(() => {
          try {
            signalGroup(child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, 1_000);
        forceKillTimer.unref?.();
      }
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        signalGroup(child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      forceKillTimer ??= setTimeout(() => {
        try {
          signalGroup(child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 1_000);
      forceKillTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();

    const finish = async (error, code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      try {
        if (logPath) await writeLog(logPath, stdout, stderr);
      } catch (writeError) {
        rejectRun(new Error(`command_log_write_failed:${writeError.message}`));
        return;
      }
      if (error) {
        rejectRun(new Error(`command_start_failed:${path.basename(command)}:${redact(error.message)}`));
        return;
      }
      if (timedOut) {
        rejectRun(new Error(`command_timeout:${path.basename(command)}:${timeoutMs}`));
        return;
      }
      if (outputExceeded) {
        rejectRun(new Error(`command_output_limit:${path.basename(command)}`));
        return;
      }
      if (!allowNonzero && code !== 0) {
        rejectRun(new Error(
          `command_failed:${path.basename(command)}:exit=${code ?? signal ?? "unknown"}:${redact(stderr).slice(-1_000)}`,
        ));
        return;
      }
      resolveRun({ code, signal, stdout, stderr });
    };
    child.once("error", (error) => void finish(error));
    child.once("close", (code, signal) => void finish(null, code, signal));
  });
}

async function requestJson(url, timeoutMs = 2_000) {
  const target = new URL(url);
  if (
    target.protocol !== "http:"
    || target.hostname !== "127.0.0.1"
    || target.username
    || target.password
  ) {
    throw new Error("smoke_http_target_must_be_loopback_http");
  }
  return await new Promise((resolveRequest, rejectRequest) => {
    const req = makeHttpRequest(
      {
        protocol: "http:",
        hostname: target.hostname,
        port: Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { accept: "application/json" },
        agent: false,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1_000_000) {
            req.destroy(new Error("local_smoke_response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.once("error", rejectRequest);
        res.once("end", () => {
          try {
            resolveRequest({
              statusCode: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (error) {
            rejectRequest(error);
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("local_smoke_request_timeout")));
    req.once("error", rejectRequest);
    req.end();
  });
}

async function isPortFree(port) {
  const server = createServer();
  return await new Promise((resolveFree) => {
    server.once("error", () => resolveFree(false));
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => resolveFree(!error));
    });
  });
}

function readProcessGroupPids(groupId) {
  const pids = [];
  try {
    const names = readdirSync("/proc");
    for (const name of names) {
      if (!/^\d+$/u.test(name)) continue;
      try {
        const statText = readFileSync(`/proc/${name}/stat`, "utf8");
        const end = statText.lastIndexOf(")");
        if (end < 0) continue;
        const fields = statText.slice(end + 1).trim().split(/\s+/u);
        if (fields[0] !== "Z" && Number(fields[2]) === groupId) pids.push(Number(name));
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ESRCH") {
          return { available: false, pids: [] };
        }
      }
    }
  } catch {
    return { available: false, pids: [] };
  }
  return { available: true, pids: pids.sort((left, right) => left - right) };
}

async function waitForExit(api, timeoutMs) {
  if (api.child.exitCode !== null || api.child.signalCode !== null) return true;
  const exitResult = await Promise.race([
    api.exitPromise.then(() => true),
    new Promise((resolveWait) => {
      const timer = setTimeout(() => resolveWait(false), timeoutMs);
      timer.unref?.();
    }),
  ]);
  return exitResult === true;
}

function parseAuditFile(auditPath) {
  let text;
  try {
    text = readFileSync(auditPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

async function createDependencies({ resultsDir }) {
  const heldPorts = new Set();
  let tmpParentRealPath;
  let apiReservation;
  let databaseReservation;
  let runtimeRoot;
  let runtimeRootRealPath;
  let database;

  const outputPath = (name) => path.join(resultsDir, name);

  return {
    async cleanupReservations(context) {
      const reservations = [
        context.preflight?.apiReservation,
        context.preflight?.databaseReservation,
      ].filter(Boolean);
      let released = 0;
      for (const reservation of reservations) {
        await reservation.release();
        released += 1;
      }
      return { released };
    },

    async preflight() {
      if (process.platform !== "linux") {
        throw new Error("linux_runner_required");
      }
      if (typeof process.getuid === "function" && process.getuid() === 0) {
        throw new Error("refusing_to_run_as_root");
      }
      const snapshot = readLoopbackOnlyNetworkSnapshot();
      const isolation = inspectLoopbackOnlyNetworkSnapshot(snapshot);
      await writeFile(
        outputPath("network-preflight.json"),
        `${JSON.stringify({ snapshot, isolation }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      if (!isolation.ok) {
        throw new Error(`os_egress_isolation_not_verified:${isolation.reasons.join(",")}`);
      }
      if (process.env.ENGINEERINGOS_API_ONLY_SMOKE_DISPOSABLE_CHECKOUT !== "1") {
        throw new Error("explicit_disposable_checkout_confirmation_required");
      }
      await requireNoExistingApiDist();
      const capabilities = parseCapabilities();
      const childNamespace = assertChildNamespace(snapshot.selfNetNamespace);
      const paths = {
        node: await realpath(process.execPath),
        pnpm: await resolveExecutable("pnpm"),
        initdb: await resolveExecutable("initdb"),
        pg_ctl: await resolveExecutable("pg_ctl"),
        createdb: await resolveExecutable("createdb"),
        psql: await resolveExecutable("psql"),
      };
      const workspaceRealPath = await realpath(workspaceRoot);
      const apiRootRealPath = await realpath(apiRoot);
      if (!isWithin(workspaceRealPath, apiRootRealPath)) {
        throw new Error("api_root_realpath_outside_workspace");
      }
      await access(apiBuildScript, fsConstants.R_OK);
      await access(egressGuardPath, fsConstants.R_OK);
      const apiPackage = JSON.parse(
        await readFile(path.join(apiRoot, "package.json"), "utf8"),
      );
      const databasePackage = JSON.parse(
        await readFile(path.join(workspaceRoot, "lib/db/package.json"), "utf8"),
      );
      if (
        apiPackage.scripts?.build !== expectedApiBuildScript
        || apiPackage.scripts?.start !== expectedApiStartScript
        || databasePackage.scripts?.["schema:apply"] !== expectedSchemaApplyScript
      ) {
        throw new Error("api_build_start_or_official_schema_apply_contract_changed");
      }
      const drizzleConfig = await readFile(
        path.join(workspaceRoot, "lib/db/drizzle.config.ts"),
        "utf8",
      );
      if (!/url:\s*process\.env\.DATABASE_URL/u.test(drizzleConfig)) {
        throw new Error("drizzle_schema_apply_not_bound_to_explicit_database_url");
      }
      tmpParentRealPath = await realpath(os.tmpdir());
      const roots = [
        path.join(workspaceRoot, "artifacts/api-server/src/index.ts"),
        apiBuildScript,
        path.join(workspaceRoot, "lib/db/drizzle.config.ts"),
        path.join(workspaceRoot, "lib/db/package.json"),
      ];
      for (const sourcePath of roots) await access(sourcePath, fsConstants.R_OK);
      const sourceTreeSha256 = await hashSourceTree();
      apiReservation = await reserveLoopbackPort(heldPorts);
      try {
        databaseReservation = await reserveLoopbackPort(heldPorts);
      } catch (error) {
        await apiReservation.release();
        throw error;
      }
      const preflight = {
        networkNamespace: snapshot.selfNetNamespace,
        apiPort: apiReservation.port,
        databasePort: databaseReservation.port,
        apiReservation,
        databaseReservation,
        paths,
        workspaceRealPath,
        tmpParentRealPath,
        sourceTreeSha256,
        report: {
          platform: process.platform,
          nodeVersion: process.version,
          networkNamespace: snapshot.selfNetNamespace,
          childNetworkNamespace: childNamespace,
          interfaces: snapshot.interfaces,
          ipv4Routes: snapshot.ipv4Routes,
          ipv6Routes: snapshot.ipv6Routes,
          isolation: { ok: isolation.ok, reasons: isolation.reasons },
          capabilities,
          tools: paths,
          workspaceRoot: workspaceRealPath,
          sourceTreeSha256,
          apiPort: apiReservation.port,
          databasePort: databaseReservation.port,
          forbiddenPortsNotSelected: [...forbiddenPorts],
          apiDistAbsentBeforeBuild: true,
          commands: {
            apiBuild: expectedApiBuildScript,
            apiStart: expectedApiStartScript,
            schemaApply: expectedSchemaApplyScript,
          },
        },
      };
      return preflight;
    },

    async buildApi(context) {
      const env = minimalEnvironment({
        home: resultsDir,
        tempDir: resultsDir,
      });
      const beforeHash = await hashSourceTree();
      await requireNoExistingApiDist();
      const build = await runCommand(
        context.preflight.paths.node,
        [apiBuildScript],
        {
          cwd: workspaceRoot,
          env,
          timeoutMs: 180_000,
          logPath: outputPath("api-build.log"),
        },
      );
      const entryInfo = await stat(apiEntrypoint);
      if (!entryInfo.isFile() || entryInfo.size === 0) {
        throw new Error("compiled_api_entrypoint_missing_or_empty");
      }
      const entrypointRealPath = await realpath(apiEntrypoint);
      if (!isWithin(await realpath(apiRoot), entrypointRealPath)) {
        throw new Error("compiled_api_entrypoint_outside_api_dist");
      }
      const afterHash = await hashSourceTree();
      if (beforeHash !== afterHash || beforeHash !== context.preflight.sourceTreeSha256) {
        throw new Error("api_source_changed_during_build");
      }
      const entrypointSha256 = createHash("sha256")
        .update(await readFile(entrypointRealPath))
        .digest("hex");
      return {
        entrypoint: entrypointRealPath,
        entrypointSha256,
        sourceTreeSha256: afterHash,
        report: {
          buildCommand: "node artifacts/api-server/build.mjs",
          entrypoint: entrypointRealPath,
          entrypointSha256,
          sourceTreeSha256: afterHash,
          outputBytes: entryInfo.size,
          buildExitCode: build.code,
        },
      };
    },

    async createDatabase(context) {
      const rootTemplate = path.join(os.tmpdir(), "engineeringos-api-only-smoke-");
      runtimeRoot = await mkdtemp(rootTemplate);
      database = {
        owned: true,
        rootVerified: false,
        rootPath: runtimeRoot,
        initialized: false,
        startAttempted: false,
        started: false,
      };
      context.database = database;
      runtimeRootRealPath = await realpath(runtimeRoot);
      if (!isWithin(tmpParentRealPath, runtimeRootRealPath)) {
        throw new Error("temporary_database_root_outside_system_temp");
      }
      database.rootVerified = true;
      database.rootPath = runtimeRootRealPath;
      const dataDirectory = path.join(runtimeRootRealPath, "pgdata");
      const databaseUrl =
        `postgresql://${databaseUser}@127.0.0.1:${context.preflight.databasePort}/${databaseName}?sslmode=disable`;
      Object.assign(database, {
        dataDirectory,
        logPath: outputPath("postgres.log"),
        host: "127.0.0.1",
        port: context.preflight.databasePort,
        databaseName,
        databaseUrl,
        tools: context.preflight.paths,
        report: {
          host: "127.0.0.1",
          port: context.preflight.databasePort,
          databaseName,
          temporaryRoot: runtimeRootRealPath,
        },
      });
      await context.preflight.databaseReservation.release();
      await runCommand(
        context.preflight.paths.initdb,
        [
          "-D", dataDirectory,
          "-U", databaseUser,
          "--auth=trust",
          "--no-locale",
          "--encoding=UTF8",
        ],
        {
          cwd: workspaceRoot,
          env: minimalEnvironment({
            home: runtimeRootRealPath,
            tempDir: runtimeRootRealPath,
          }),
          timeoutMs: 90_000,
          logPath: outputPath("initdb.log"),
        },
      );
      database.initialized = true;
      database.startAttempted = true;
      await runCommand(
        context.preflight.paths.pg_ctl,
        [
          "-D", dataDirectory,
          "-o",
          `-h 127.0.0.1 -p ${database.port} -c listen_addresses=127.0.0.1`,
          "-l", database.logPath,
          "-w",
          "start",
        ],
        {
          cwd: workspaceRoot,
          env: minimalEnvironment({
            home: runtimeRootRealPath,
            tempDir: runtimeRootRealPath,
          }),
          timeoutMs: 45_000,
          logPath: outputPath("pg-ctl-start.log"),
        },
      );
      database.started = true;
      await runCommand(
        context.preflight.paths.createdb,
        [
          "--host", database.host,
          "--port", String(database.port),
          "--username", databaseUser,
          "--owner", databaseUser,
          databaseName,
        ],
        {
          cwd: workspaceRoot,
          env: {
            ...minimalEnvironment({
              home: runtimeRootRealPath,
              tempDir: runtimeRootRealPath,
            }),
            PGSSLMODE: "disable",
          },
          timeoutMs: 15_000,
          logPath: outputPath("createdb.log"),
        },
      );
      return database;
    },

    async applySchema(db, context) {
      await runCommand(
        context.preflight.paths.pnpm,
        ["--filter", "@workspace/db", "run", "schema:apply"],
        {
          cwd: workspaceRoot,
          env: {
            ...minimalEnvironment({
              home: db.rootPath,
              tempDir: db.rootPath,
              databaseUrl: db.databaseUrl,
            }),
            DATABASE_URL: db.databaseUrl,
          },
          timeoutMs: 180_000,
          logPath: outputPath("schema-apply.log"),
        },
      );
    },

    async readDatabaseIdentity(db) {
      const output = await runCommand(
        db.tools.psql,
        [
          "-X",
          "-v", "ON_ERROR_STOP=1",
          "-A",
          "-t",
          "-F", "\t",
          "-c",
          "SELECT current_database(), inet_server_addr()::text, inet_server_port()::text",
        ],
        {
          cwd: workspaceRoot,
          env: {
            ...minimalEnvironment({
              home: db.rootPath,
              tempDir: db.rootPath,
              databaseUrl: db.databaseUrl,
            }),
            PGHOST: db.host,
            PGPORT: String(db.port),
            PGUSER: databaseUser,
            PGDATABASE: db.databaseName,
          },
          timeoutMs: 10_000,
          logPath: outputPath("database-identity.log"),
        },
      );
      const [name, host, portText] = output.stdout.trim().split("\t");
      const postmasterPid = Number(
        (await readFile(path.join(db.dataDirectory, "postmaster.pid"), "utf8"))
          .split(/\r?\n/u)[0],
      );
      if (!Number.isSafeInteger(postmasterPid) || postmasterPid < 2) {
        throw new Error("postgres_postmaster_pid_unverifiable");
      }
      const networkNamespace = readlinkSync(`/proc/${postmasterPid}/ns/net`);
      return {
        databaseName: name,
        host,
        port: Number(portText),
        networkNamespace,
      };
    },

    async readEntityCounts(db) {
      const environment = {
        ...minimalEnvironment({
          home: db.rootPath,
          tempDir: db.rootPath,
          databaseUrl: db.databaseUrl,
        }),
        PGHOST: db.host,
        PGPORT: String(db.port),
        PGUSER: databaseUser,
        PGDATABASE: db.databaseName,
      };
      const expectedTablesSql = expectedEntityTables
        .map((name) => `'${name}'`)
        .join(", ");
      const tablesResult = await runCommand(
        db.tools.psql,
        [
          "-X",
          "-v", "ON_ERROR_STOP=1",
          "-A",
          "-t",
          "-c",
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename IN (${expectedTablesSql}) OR tablename ~ '(mission|goal|execution|task|proposal|receipt|delivery|acceptance|episode|apply|operation)') ORDER BY tablename`,
        ],
        {
          cwd: workspaceRoot,
          env: environment,
          timeoutMs: 15_000,
        logPath: outputPath("entity-table-list.log"),
        },
      );
      const names = tablesResult.stdout.trim().split(/\r?\n/u).filter(Boolean);
      const uniqueNames = [...new Set(names)];
      for (const name of uniqueNames) {
        if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
          throw new Error("unexpected_entity_table_identifier");
        }
      }
      const missing = expectedEntityTables.filter((name) => !uniqueNames.includes(name));
      if (missing.length) {
        throw new Error(`expected_entity_tables_missing:${missing.join(",")}`);
      }
      const counts = {};
      for (const name of uniqueNames) {
        const result = await runCommand(
          db.tools.psql,
          [
            "-X",
            "-v", "ON_ERROR_STOP=1",
            "-A",
            "-t",
            "-c",
            `SELECT count(*)::text FROM public."${name}"`,
          ],
          {
            cwd: workspaceRoot,
            env: environment,
            timeoutMs: 10_000,
            logPath: outputPath(`count-${name}.log`),
          },
        );
        const count = Number(result.stdout.trim());
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new Error(`entity_count_invalid:${name}`);
        }
        counts[name] = count;
      }
      return counts;
    },

    async startApi(db, context) {
      const env = createApiSmokeEnvironment({
        databaseUrl: db.databaseUrl,
        databasePort: db.port,
        port: context.preflight.apiPort,
        auditPath: outputPath("api-egress-audit.jsonl"),
        workerScopeProjectId: randomUUID(),
        home: db.rootPath,
        tempDir: db.rootPath,
      });
      await context.preflight.apiReservation.release();
      const child = spawn(
        context.preflight.paths.node,
        ["--enable-source-maps", "--import", egressGuardPath, context.build.entrypoint],
        {
          cwd: workspaceRoot,
          env,
          detached: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      if (!Number.isInteger(child.pid) || child.pid < 2) {
        throw new Error("api_child_process_pid_unavailable");
      }
      const api = {
        owned: true,
        child,
        pid: child.pid,
        port: context.preflight.apiPort,
        networkNamespace: undefined,
        exitPromise: undefined,
        outputExceeded: false,
        logStream: createWriteStream(
          outputPath("api.log"),
          { flags: "wx", mode: 0o600 },
        ),
      };
      context.api = api;
      api.networkNamespace = readlinkSync(`/proc/${child.pid}/ns/net`);
      api.cwd = readlinkSync(`/proc/${child.pid}/cwd`);
      api.exitPromise = new Promise((resolveExit) => {
        child.once("exit", (code, signal) => resolveExit({ code, signal }));
        child.once("error", (error) => resolveExit({ error }));
      });
      let outputBytes = 0;
      const append = (label, chunk) => {
        const remaining = maxApiOutputBytes - outputBytes;
        if (remaining <= 0) {
          api.outputExceeded = true;
          signalGroup(api.pid, "SIGTERM");
          return;
        }
        const prefix = Buffer.from(`[${label}] `);
        const data = Buffer.concat([prefix, chunk]).subarray(0, remaining);
        outputBytes += data.length;
        api.logStream.write(data);
        if (data.length < prefix.length + chunk.length) {
          api.outputExceeded = true;
          signalGroup(api.pid, "SIGTERM");
        }
      };
      child.stdout.on("data", (chunk) => append("stdout", chunk));
      child.stderr.on("data", (chunk) => append("stderr", chunk));
      child.once("error", (error) => {
        api.startError = redact(error.message);
      });
      return api;
    },

    async waitForReadiness(api) {
      const deadline = Date.now() + apiStartupTimeoutMs;
      let lastFailure = "readiness_not_checked";
      while (Date.now() < deadline) {
        if (api.outputExceeded) throw new Error("api_output_limit_exceeded");
        if (api.child.exitCode !== null || api.startError) {
          throw new Error(`api_exited_before_readiness:${api.startError ?? api.child.exitCode}`);
        }
        try {
          const health = await requestJson(`http://127.0.0.1:${api.port}/api/healthz`);
          const readiness = await requestJson(`http://127.0.0.1:${api.port}/api/readiness`);
          if (
            health.statusCode === 200
            && readiness.statusCode === 200
            && health.body?.status === "ok"
            && readiness.body?.status === "ready"
          ) {
            return { health: health.body, readiness: readiness.body };
          }
          lastFailure = `health=${health.statusCode},readiness=${readiness.statusCode}`;
        } catch (error) {
          lastFailure = redact(error.message);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      }
      throw new Error(`api_readiness_timeout:${lastFailure}`);
    },

    async localSmoke(api) {
      const requests = [];
      for (const pathname of ["/api/healthz", "/api/readiness"]) {
        const response = await requestJson(`http://127.0.0.1:${api.port}${pathname}`);
        if (response.statusCode !== 200) {
          throw new Error(`local_get_failed:${pathname}:${response.statusCode}`);
        }
        requests.push({
          method: "GET",
          path: pathname,
          local: true,
          status: response.statusCode,
        });
      }
      return { readOnly: true, requests };
    },

    async stopApi(api) {
      if (!api?.owned || !Number.isInteger(api.pid) || api.pid < 2) {
        throw new Error("refusing_to_stop_unowned_api_process");
      }
      if (api.child.exitCode === null && api.child.signalCode === null) {
        signalGroup(api.pid, "SIGTERM");
        const exited = await waitForExit(api, apiStopTimeoutMs);
        if (!exited) {
          signalGroup(api.pid, "SIGKILL");
          if (!(await waitForExit(api, 2_000))) {
            throw new Error("api_process_group_did_not_exit");
          }
        }
      }
      await new Promise((resolveFinish) => {
        if (api.logStream.closed) return resolveFinish();
        api.logStream.end(resolveFinish);
      });
      const group = readProcessGroupPids(api.pid);
      const audit = parseAuditFile(outputPath("api-egress-audit.jsonl"));
      const startedPids = new Set(
        audit.filter((event) => event.kind === "child-started")
          .map((event) => event.pid),
      );
      const exitedPids = new Set(
        audit.filter((event) => event.kind === "child-exited" || event.kind === "child-error")
          .map((event) => event.pid),
      );
      const childProcessesExited = [...startedPids].every((pid) => exitedPids.has(pid));
      const portFree = await isPortFree(api.port);
      return {
        stopped: api.child.exitCode !== null || api.child.signalCode !== null,
        portFree,
        remainingPids: group.available ? group.pids : ["unverifiable"],
        childProcessesExited: group.available && childProcessesExited,
      };
    },

    async readAudit() {
      return parseAuditFile(outputPath("api-egress-audit.jsonl"));
    },

    async persistEvidence(report) {
      const target = outputPath("report.json");
      const temporary = `${target}.tmp`;
      await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, target);
    },

    async cleanupDatabase(db) {
      if (
        !db?.owned
        || !db.rootVerified
        || !runtimeRootRealPath
        || db.rootPath !== runtimeRootRealPath
        || !isWithin(tmpParentRealPath, db.rootPath)
      ) {
        throw new Error("refusing_to_clean_unowned_database_root");
      }
      let clusterStopped = !db.startAttempted;
      if (db.initialized && db.startAttempted) {
        const status = await runCommand(
          db.tools.pg_ctl,
          ["-D", db.dataDirectory, "status"],
          {
            cwd: workspaceRoot,
            env: minimalEnvironment({ home: db.rootPath, tempDir: db.rootPath }),
            timeoutMs: 10_000,
            allowNonzero: true,
            logPath: outputPath("pg-ctl-status.log"),
          },
        );
        if (status.code === 0) {
          const stop = await runCommand(
            db.tools.pg_ctl,
            ["-D", db.dataDirectory, "-m", "fast", "-w", "stop"],
            {
              cwd: workspaceRoot,
              env: minimalEnvironment({ home: db.rootPath, tempDir: db.rootPath }),
              timeoutMs: 20_000,
              logPath: outputPath("pg-ctl-stop.log"),
            },
          );
          if (stop.code !== 0) throw new Error("postgres_cluster_stop_failed");
          db.started = false;
          clusterStopped = true;
        } else if (/no server running/iu.test(`${status.stdout}\n${status.stderr}`)) {
          db.started = false;
          clusterStopped = true;
        } else {
          throw new Error("postgres_cluster_state_unverifiable");
        }
      }
      const currentRealPath = await realpath(db.rootPath);
      if (currentRealPath !== runtimeRootRealPath) {
        throw new Error("database_root_realpath_changed_before_cleanup");
      }
      await rm(currentRealPath, { recursive: true, force: false });
      return { removed: true, clusterStopped };
    },
  };
}

async function main() {
  const runId = randomUUID();
  await mkdir(resultsParent, { recursive: true });
  const resultsParentInfo = await lstat(resultsParent);
  if (resultsParentInfo.isSymbolicLink() || !resultsParentInfo.isDirectory()) {
    throw new Error("api_smoke_results_root_must_be_a_real_directory");
  }
  const resultsParentRealPath = await realpath(resultsParent);
  const workspaceRealPath = await realpath(workspaceRoot);
  if (!isWithin(workspaceRealPath, resultsParentRealPath)) {
    throw new Error("api_smoke_results_root_outside_workspace");
  }
  const resultsDir = path.join(resultsParentRealPath, runId);
  await mkdir(resultsDir, { recursive: false, mode: 0o700 });
  const dependencies = await createDependencies({ resultsDir });
  const report = await runApiOnlySmoke(dependencies, { runId });
  console.log(JSON.stringify({
    apiSmokeStatus: report.apiSmokeStatus,
    lifecycleStatus: report.lifecycleStatus,
    failingPhase: report.failure?.phase ?? null,
    reportPath: path.join(resultsDir, "report.json"),
  }, null, 2));
  process.exitCode = report.apiSmokeStatus === "passed" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(redact(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}

export { requestJson, reserveLoopbackPort };
