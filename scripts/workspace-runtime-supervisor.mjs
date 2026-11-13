import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import {
  chmod, chown, lstat, open, readFile, readdir, readlink, realpath, rename, stat, unlink,
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { verifyWorkspaceRuntimeSupervisorCommand } from "./workspace-runtime-supervisor-protocol.mjs";

const SOCKET_PATH = process.env.WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH;
const API_GID = Number(process.env.WORKSPACE_RUNTIME_SUPERVISOR_API_GID);
const CANDIDATE_UID = Number(process.env.WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_UID);
const CANDIDATE_GID = Number(process.env.WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_GID);
const SETPRIV_PATH = process.env.WORKSPACE_RUNTIME_SUPERVISOR_SETPRIV_PATH ?? "setpriv";
const TEST_MODE = process.env.NODE_ENV === "test"
  && process.env.WORKSPACE_RUNTIME_SUPERVISOR_TEST_MODE === "1";
const LOOPBACK_HOST = "127.0.0.1";
const CONTROL_DIRECTORY = typeof SOCKET_PATH === "string" ? path.dirname(SOCKET_PATH) : "";
const REPLAY_LEDGER_PATH = process.env.WORKSPACE_RUNTIME_SUPERVISOR_REPLAY_LEDGER_PATH
  ?? (CONTROL_DIRECTORY ? path.join(CONTROL_DIRECTORY, ".workspace-runtime-supervisor-replay.jsonl") : "");
const PORT_MIN = 3000;
const PORT_MAX = 3099;
const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 2_000;
const MAX_LOG_LINES = 120;
const MAX_LOG_LINE_CHARS = 600;
const MAX_PROC_ENTRIES = 8_192;
const MAX_FD_ENTRIES = 4_096;
const MAX_PROC_STAT_BYTES = 16 * 1024;
const MAX_TCP_TABLE_BYTES = 2 * 1024 * 1024;
const SAFE_ENV_NAMES = new Set(["PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "TMPDIR", "PNPM_HOME"]);
const SAFE_LOCALE_ENV_NAME = /^LC_[A-Z_]+$/;
const ALLOWED_PROJECT_ROOTS_JSON = process.env.WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON;
const CHILD_ATTESTATION_ENV_NAME = "ENGINEERINGOS_CHILD_ATTESTATION";
const sessions = new Map();
const startLocks = new Map();
const reservedRuntimePorts = new Set();
const consumedCommandIds = new Map();
const consumedNonces = new Set();
let replayWriteTail = Promise.resolve();
let replayRecordsSinceCompaction = 0;
let portReservationTail = Promise.resolve();

if (!SOCKET_PATH || !path.isAbsolute(SOCKET_PATH) || !path.basename(SOCKET_PATH)) {
  throw new Error("Workspace runtime supervisor requires an absolute Unix socket path.");
}
if (!Number.isInteger(API_GID) || API_GID < 1) {
  throw new Error("Workspace runtime supervisor API group is not configured.");
}
if (
  !Number.isInteger(CANDIDATE_UID) || CANDIDATE_UID < 1
  || !Number.isInteger(CANDIDATE_GID) || CANDIDATE_GID < 1
  || (!TEST_MODE && CANDIDATE_GID === API_GID)
) {
  throw new Error("Workspace runtime candidate identity is not isolated from the API control group.");
}
if (process.platform !== "linux" || typeof process.getuid !== "function") {
  throw new Error("Workspace runtime supervisor Unix socket isolation requires Linux.");
}
if (!TEST_MODE && CANDIDATE_UID === process.getuid()) {
  throw new Error("Workspace runtime candidate UID must differ from the supervisor UID.");
}
if (!TEST_MODE && process.getgroups().includes(API_GID)) {
  throw new Error("Supervisor must not inherit the API control group; use a dedicated runner account.");
}
if (!REPLAY_LEDGER_PATH || path.dirname(path.resolve(REPLAY_LEDGER_PATH)) !== path.resolve(CONTROL_DIRECTORY)) {
  throw new Error("Workspace runtime replay ledger must reside in the supervisor control directory.");
}

let ALLOWED_PROJECT_ROOTS;
try { ALLOWED_PROJECT_ROOTS = JSON.parse(ALLOWED_PROJECT_ROOTS_JSON ?? ""); }
catch { throw new Error("Workspace runtime allowed project roots are not valid JSON."); }
if (
  !Array.isArray(ALLOWED_PROJECT_ROOTS)
  || ALLOWED_PROJECT_ROOTS.length === 0
  || ALLOWED_PROJECT_ROOTS.length > 16
  || ALLOWED_PROJECT_ROOTS.some((root) => typeof root !== "string" || !path.isAbsolute(root))
) throw new Error("Workspace runtime allowed project roots are not configured.");

const publicKeyEncoded = process.env.WORKSPACE_RUNTIME_SUPERVISOR_VERIFY_PUBLIC_KEY_B64;
if (!publicKeyEncoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKeyEncoded)) {
  throw new Error("Workspace runtime supervisor verification key is not configured.");
}
let SUPERVISOR_VERIFY_PUBLIC_KEY;
try {
  const der = Buffer.from(publicKeyEncoded, "base64");
  if (der.toString("base64") !== publicKeyEncoded) throw new Error("Non-canonical public key encoding.");
  SUPERVISOR_VERIFY_PUBLIC_KEY = createPublicKey({ key: der, format: "der", type: "spki" });
  if (SUPERVISOR_VERIFY_PUBLIC_KEY.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 key required.");
} catch {
  throw new Error("Workspace runtime supervisor verification key is invalid.");
}

function bounded(value) {
  return String(value)
    .replace(/\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LOG_LINE_CHARS);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}


async function requestBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > 32_000) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Request body is not valid JSON."), { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Request body must be a JSON object."), { status: 400 });
  }
  return { raw, parsed };
}

function isSafeProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,200}$/.test(value);
}

function runtimeEnv(port, attestationMarker) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && (SAFE_ENV_NAMES.has(name) || SAFE_LOCALE_ENV_NAME.test(name))) env[name] = value;
  }
  env.NODE_ENV = "development";
  env.PORT = String(port);
  env.BASE_PATH = "/";
  if (attestationMarker) env.ENGINEERINGOS_CHILD_ATTESTATION = attestationMarker;
  return env;
}

function spawnCandidate(projectRoot, port, attestationMarker) {
  const env = runtimeEnv(port, attestationMarker);
  if (TEST_MODE) {
    return spawn("pnpm", ["run", "dev"], {
      cwd: projectRoot, env, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn(SETPRIV_PATH, [
    "--reuid", String(CANDIDATE_UID),
    "--regid", String(CANDIDATE_GID),
    "--clear-groups",
    "--", "pnpm", "run", "dev",
  ], {
    cwd: projectRoot, env, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
  });
}

function isPortListening(port) {
  if (!Number.isInteger(port)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: LOOPBACK_HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function reserveRuntimePort() {
  let release;
  const previous = portReservationTail;
  portReservationTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
      if (reservedRuntimePorts.has(port)) continue;
      const available = await new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen({ host: LOOPBACK_HOST, port }, () => server.close(() => resolve(true)));
      });
      if (available) {
        reservedRuntimePorts.add(port);
        return port;
      }
    }
    throw new Error("No managed runtime port is available.");
  } finally {
    release();
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function parseProcessIdentity(pid, statLine) {
  const commandEnd = statLine.lastIndexOf(")");
  if (commandEnd < 0) return null;
  const fields = statLine.slice(commandEnd + 1).trim().split(/\s+/);
  const parentPid = Number(fields[1]);
  const startTime = fields[19];
  if (!Number.isInteger(parentPid) || parentPid < 0 || !/^\d+$/.test(startTime ?? "")) {
    return null;
  }
  return { pid, parentPid, startTime };
}

async function readProcessIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`);
    if (stat.byteLength > MAX_PROC_STAT_BYTES) return { identity: null, complete: false };
    const identity = parseProcessIdentity(pid, stat.toString("utf8"));
    return { identity, complete: identity !== null };
  } catch (error) {
    if (error.code === "ENOENT") return { identity: null, complete: true };
    return { identity: null, complete: false };
  }
}

async function resolveProcessTree(launchPid) {
  let entries;
  try {
    entries = await readdir("/proc", { withFileTypes: true });
  } catch {
    return null;
  }
  const pids = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  if (pids.length > MAX_PROC_ENTRIES) return null;

  const processes = new Map();
  let complete = true;
  for (let offset = 0; offset < pids.length; offset += 64) {
    const results = await Promise.all(
      pids.slice(offset, offset + 64).map(readProcessIdentity),
    );
    for (const result of results) {
      if (!result.complete) complete = false;
      if (result.identity) processes.set(result.identity.pid, result.identity);
    }
  }
  if (!processes.has(launchPid)) return null;

  const childrenByParent = new Map();
  for (const identity of processes.values()) {
    const children = childrenByParent.get(identity.parentPid) ?? [];
    children.push(identity.pid);
    childrenByParent.set(identity.parentPid, children);
  }
  const descendants = new Set([launchPid]);
  const pending = [launchPid];
  while (pending.length > 0 && descendants.size <= MAX_PROC_ENTRIES) {
    const parent = pending.pop();
    for (const childPid of childrenByParent.get(parent) ?? []) {
      if (descendants.has(childPid)) continue;
      descendants.add(childPid);
      pending.push(childPid);
    }
  }
  return {
    processes,
    descendants,
    complete,
    truncated: descendants.size > MAX_PROC_ENTRIES,
  };
}

function parseListeningSocketInodes(contents, port) {
  const inodes = new Set();
  for (const line of contents.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 10 || columns[3] !== "0A") continue;
    const localAddress = columns[1];
    const separator = localAddress?.lastIndexOf(":") ?? -1;
    if (separator < 0) continue;
    const localPort = Number.parseInt(localAddress.slice(separator + 1), 16);
    const inode = columns[9];
    if (localPort === port && /^\d+$/.test(inode ?? "") && inode !== "0") inodes.add(inode);
  }
  return inodes;
}

async function readListenerInodes(port) {
  try {
    const [tcp, tcp6] = await Promise.all([
      readFile("/proc/net/tcp"),
      readFile("/proc/net/tcp6").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    ]);
    if (tcp.byteLength > MAX_TCP_TABLE_BYTES || (tcp6 && tcp6.byteLength > MAX_TCP_TABLE_BYTES)) {
      return null;
    }
    const inodes = parseListeningSocketInodes(tcp.toString("utf8"), port);
    if (tcp6) {
      for (const inode of parseListeningSocketInodes(tcp6.toString("utf8"), port)) {
        inodes.add(inode);
      }
    }
    return inodes;
  } catch {
    return null;
  }
}

async function resolveSocketOwners(descendants, expectedInodes) {
  const owners = new Map();
  let complete = true;
  for (const pid of descendants) {
    let descriptors;
    try {
      descriptors = await readdir(`/proc/${pid}/fd`);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      complete = false;
      continue;
    }
    if (descriptors.length > MAX_FD_ENTRIES) {
      complete = false;
      continue;
    }
    for (const descriptor of descriptors) {
      let target;
      try {
        target = await readlink(`/proc/${pid}/fd/${descriptor}`);
      } catch (error) {
        if (error.code !== "ENOENT") complete = false;
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (!match || !expectedInodes.has(match[1])) continue;
      const inodeOwners = owners.get(match[1]) ?? new Set();
      inodeOwners.add(pid);
      owners.set(match[1], inodeOwners);
    }
  }
  return { owners, complete };
}

async function resolveOwnedRuntimeListener(launchPid, port, bindingDigest) {
  if (process.platform !== "linux") return null;
  const initialTree = await resolveProcessTree(launchPid);
  if (!initialTree?.complete || initialTree.truncated) return null;
  const launchIdentity = initialTree.processes.get(launchPid);
  if (!launchIdentity) return null;
  const listenerInodes = await readListenerInodes(port);
  if (!listenerInodes?.size) return null;
  const initialOwners = await resolveSocketOwners(initialTree.descendants, listenerInodes);
  if (!initialOwners.complete) return null;
  const ownerPids = new Set();
  for (const inode of listenerInodes) {
    const owners = initialOwners.owners.get(inode);
    if (!owners?.size) return null;
    for (const pid of owners) ownerPids.add(pid);
  }
  if (ownerPids.size !== 1) return null;
  const listenerPid = [...ownerPids][0];
  const listenerIdentity = initialTree.processes.get(listenerPid);
  if (!listenerIdentity || !initialTree.descendants.has(listenerPid)) return null;
  if ([...initialOwners.owners.values()].some(
    (owners) => owners.size !== 1 || !owners.has(listenerPid),
  )) return null;

  const afterTree = await resolveProcessTree(launchPid);
  if (!afterTree?.complete || afterTree.truncated) return null;
  const [afterListenerInodes, finalOwners] = await Promise.all([
    readListenerInodes(port),
    resolveSocketOwners(afterTree.descendants, listenerInodes),
  ]);
  if (!afterListenerInodes || !finalOwners.complete) return null;
  const afterLaunch = afterTree.processes.get(launchPid);
  const afterListener = afterTree.processes.get(listenerPid);
  const sameInodes = listenerInodes.size === afterListenerInodes.size
    && [...listenerInodes].every((inode) => afterListenerInodes.has(inode));
  const sameOwners = [...listenerInodes].every((inode) => {
    const owners = finalOwners.owners.get(inode);
    return owners?.size === 1 && owners.has(listenerPid);
  });
  if (
    afterLaunch?.startTime !== launchIdentity.startTime
    || afterListener?.startTime !== listenerIdentity.startTime
    || !afterTree.descendants.has(listenerPid)
    || !sameInodes
    || !sameOwners
  ) return null;

  return {
    pid: listenerPid,
    identityDigest: createHash("sha256").update(JSON.stringify({
      schema: "runtime-listener-process-v1",
      bindingDigest,
      launchPid,
      launchStartTime: launchIdentity.startTime,
      listenerPid,
      listenerStartTime: listenerIdentity.startTime,
      port,
      socketInodes: [...listenerInodes].sort(),
    })).digest("hex"),
  };
}

async function processIsWithinRoot(pid, projectRoot) {
  try {
    const cwdLink = await readlink(`/proc/${pid}/cwd`);
    const cwd = await realpath(cwdLink);
    const relative = path.relative(projectRoot, cwd);
    return relative === ""
      || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  } catch {
    return false;
  }
}

async function processHasAttestationMarker(pid, expectedMarker) {
  let environment;
  try {
    environment = await readFile(`/proc/${pid}/environ`);
    const name = Buffer.from(`${CHILD_ATTESTATION_ENV_NAME}=`, "utf8");
    const expected = Buffer.from(expectedMarker, "utf8");
    let count = 0;
    let matches = false;
    let offset = 0;
    while (offset < environment.length) {
      const end = environment.indexOf(0, offset);
      const entryEnd = end < 0 ? environment.length : end;
      const entry = environment.subarray(offset, entryEnd);
      if (entry.length >= name.length && entry.subarray(0, name.length).equals(name)) {
        count += 1;
        const observed = entry.subarray(name.length);
        matches = observed.length === expected.length
          && timingSafeEqual(observed, expected);
      }
      offset = entryEnd + 1;
    }
    return count === 1 && matches;
  } catch {
    return false;
  } finally {
    environment?.fill(0);
  }
}

async function verifyRuntimeAdoption(input, projectRoot) {
  if (
    typeof input.listenerBindingDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(input.listenerBindingDigest)
    || (input.expectedListenerIdentityDigest !== undefined
      && (typeof input.expectedListenerIdentityDigest !== "string"
        || !/^[a-f0-9]{64}$/.test(input.expectedListenerIdentityDigest)))
    || (input.attestationMarker !== undefined
      && (typeof input.attestationMarker !== "string" || !/^[a-f0-9]{64}$/.test(input.attestationMarker)))
  ) {
    throw Object.assign(new Error("Runtime adoption proof is invalid."), { status: 400 });
  }
  const first = await resolveOwnedRuntimeListener(
    input.pid,
    input.port,
    input.listenerBindingDigest,
  );
  if (
    !first
    || (input.expectedListenerIdentityDigest
      && first.identityDigest !== input.expectedListenerIdentityDigest)
    || !await processIsWithinRoot(input.pid, projectRoot)
    || !await processIsWithinRoot(first.pid, projectRoot)
  ) {
    throw Object.assign(new Error("Runtime listener ownership could not be verified."), { status: 409 });
  }
  if (input.attestationMarker && (
    !await processHasAttestationMarker(input.pid, input.attestationMarker)
    || !await processHasAttestationMarker(first.pid, input.attestationMarker)
  )) {
    throw Object.assign(new Error("Runtime child-process attestation did not match."), { status: 409 });
  }
  const second = await resolveOwnedRuntimeListener(
    input.pid,
    input.port,
    input.listenerBindingDigest,
  );
  if (!second || second.identityDigest !== first.identityDigest) {
    throw Object.assign(new Error("Runtime listener changed during adoption."), { status: 409 });
  }
  return first;
}

function signalGroup(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function isProcessGroupAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

async function terminate(session) {
  const pid = session.pid;
  session.terminationPending = true;
  try {
    signalGroup(pid, "SIGTERM");
    if (!(await waitForProcessGroupExit(pid, STOP_TIMEOUT_MS))) {
      signalGroup(pid, "SIGKILL");
      if (!(await waitForProcessGroupExit(pid, STOP_TIMEOUT_MS))) {
        throw Object.assign(new Error("Runtime process group did not stop after SIGKILL."), { status: 409 });
      }
    }
  } catch (error) {
    session.status = "failed";
    session.error = bounded(error instanceof Error ? error.message : "Runtime process group termination could not be confirmed.");
    if (error?.status) throw error;
    throw Object.assign(new Error("Runtime process group termination could not be confirmed."), { status: 409 });
  }
  session.status = "stopped";
  session.pid = null;
  session.stoppedAt = new Date().toISOString();
}

async function waitForReady(child, port) {
  let processError;
  const onError = (error) => { processError = error; };
  child.once("error", onError);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (processError) throw new Error(`Runtime process could not start: ${bounded(processError.message)}`);
      if (child.exitCode !== null) throw new Error("Runtime process exited before opening its port.");
      if (await isPortListening(port)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    child.off("error", onError);
  }
  throw new Error(`Runtime process did not open port ${port} within ${STARTUP_TIMEOUT_MS}ms.`);
}

async function validateProjectRoot(candidate) {
  const allowedRoots = [];
  try {
    for (const configuredRoot of ALLOWED_PROJECT_ROOTS) {
      const resolvedRoot = await realpath(configuredRoot);
      if (
        resolvedRoot !== path.resolve(configuredRoot)
        || !(await stat(resolvedRoot)).isDirectory()
      ) {
        throw new Error("Configured project root is not canonical.");
      }
      allowedRoots.push(resolvedRoot);
    }
  } catch {
    throw Object.assign(
      new Error("The configured workspace runtime root policy is unavailable."),
      { status: 503 },
    );
  }

  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw Object.assign(new Error("A canonical registered project root is required."), { status: 400 });
  }
  let resolved;
  try {
    resolved = await realpath(candidate);
    if (resolved !== path.resolve(candidate) || !(await stat(resolved)).isDirectory()) {
      throw new Error("Project root is not canonical.");
    }
    const isWithinAllowedRoot = allowedRoots.some((allowedRoot) => {
      const relative = path.relative(allowedRoot, resolved);
      return relative !== ".."
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative);
    });
    if (!isWithinAllowedRoot) {
      throw new Error("Project root is outside the configured workspaces.");
    }
    const manifest = JSON.parse(await readFile(path.join(resolved, "package.json"), "utf8"));
    if (typeof manifest.scripts?.dev !== "string" || !manifest.scripts.dev.trim()) {
      throw new Error("Project dev script is unavailable.");
    }
  } catch {
    throw Object.assign(new Error("The registered project root is unavailable or outside the configured workspace."), { status: 400 });
  }
  return resolved;
}

function attachLogs(session) {
  const append = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const safeLine = bounded(line);
      if (!safeLine) continue;
      session.logs.push(safeLine);
      if (session.logs.length > MAX_LOG_LINES) session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
    }
  };
  session.child?.stdout?.on("data", append);
  session.child?.stderr?.on("data", append);
}

function publicSession(session) {
  return {
    projectId: session.projectId,
    sessionId: session.sessionId,
    status: session.status,
    port: session.port,
    pid: session.pid,
    listenerIdentityDigest: session.listenerIdentityDigest ?? null,
    logs: [...session.logs],
    error: session.error ?? null,
  };
}

async function start(input, stateVersion) {
  const previous = startLocks.get(input.projectId) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  startLocks.set(input.projectId, current);
  await previous;
  try { return await startExclusive(input, stateVersion); }
  finally {
    release();
    if (startLocks.get(input.projectId) === current) startLocks.delete(input.projectId);
  }
}

async function startExclusive(input, stateVersion) {
  if (!isSafeProjectId(input.projectId) || !isSafeProjectId(input.sessionId)) {
    throw Object.assign(new Error("Invalid runtime identity."), { status: 400 });
  }
  if (input.profile !== "dev") {
    throw Object.assign(new Error("Only the server-owned dev profile is permitted."), { status: 400 });
  }
  const projectRoot = await validateProjectRoot(input.projectRoot);
  if (
    input.attestationMarker !== undefined
    && (typeof input.attestationMarker !== "string" || !/^[a-f0-9]{64}$/.test(input.attestationMarker))
  ) {
    throw Object.assign(new Error("Invalid child attestation marker."), { status: 400 });
  }
  if (
    input.listenerBindingDigest !== undefined
    && (typeof input.listenerBindingDigest !== "string"
      || !/^[a-f0-9]{64}$/.test(input.listenerBindingDigest))
  ) {
    throw Object.assign(new Error("Invalid runtime listener binding digest."), { status: 400 });
  }
  if (input.attestationMarker && !input.listenerBindingDigest) {
    throw Object.assign(new Error("Attested runtime startup requires a listener binding."), { status: 400 });
  }
  const existing = sessions.get(input.projectId);
  if (existing && (existing.status === "starting" || existing.status === "running")) {
    if (existing.sessionId === input.sessionId) {
      if (
        existing.stateVersion !== stateVersion
        || (input.attestationMarker ?? null) !== (existing.attestationMarker ?? null)
        || (input.listenerBindingDigest
          && existing.listenerBindingDigest !== input.listenerBindingDigest)
      ) {
        throw Object.assign(new Error("Runtime child attestation marker does not match the active session."), { status: 409 });
      }
      return publicSession(existing);
    }
    throw Object.assign(new Error("A different runtime session already owns this project."), { status: 409 });
  }
  if (existing) await terminate(existing);
  const port = await reserveRuntimePort();
  let child;
  try {
    child = spawnCandidate(projectRoot, port, input.attestationMarker);
  } catch (error) {
    reservedRuntimePorts.delete(port);
    throw error;
  }
  const session = {
    projectId: input.projectId,
    sessionId: input.sessionId,
    projectRoot,
    stateVersion,
    status: "starting",
    port,
    pid: child.pid ?? null,
    logs: [],
    error: null,
    child,
    terminationPending: false,
    ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
    ...(input.listenerBindingDigest
      ? { listenerBindingDigest: input.listenerBindingDigest }
      : {}),
    listenerIdentityDigest: null,
  };
  sessions.set(input.projectId, session);
  attachLogs(session);
  child.once("exit", (code, signal) => {
    if (sessions.get(input.projectId) !== session || session.terminationPending) return;
    if (session.status === "starting" || session.status === "running") {
      session.status = code === 0 ? "stopped" : "failed";
      session.error = code === 0 ? null : `Runtime exited with ${signal ?? `code ${code ?? "unknown"}`}.`;
    }
  });
  try {
    await waitForReady(child, port);
    if (input.listenerBindingDigest) {
      const proof = await verifyRuntimeAdoption({
        pid: session.pid,
        port,
        listenerBindingDigest: input.listenerBindingDigest,
        ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
      }, projectRoot);
      session.listenerIdentityDigest = proof.identityDigest;
    }
    session.status = "running";
    return publicSession(session);
  } catch (error) {
    session.status = "failed";
    session.error = bounded(error.message);
    await terminate(session);
    session.status = "failed";
    return publicSession(session);
  } finally {
    reservedRuntimePorts.delete(port);
  }
}

async function adopt(input, stateVersion) {
  if (!isSafeProjectId(input.projectId) || !isSafeProjectId(input.sessionId)) {
    throw Object.assign(new Error("Invalid runtime identity."), { status: 400 });
  }
  const projectRoot = await validateProjectRoot(input.projectRoot);
  if (
    !Number.isInteger(input.pid)
    || input.pid <= 1
    || !Number.isInteger(input.port)
    || input.port < PORT_MIN
    || input.port > PORT_MAX
  ) {
    throw Object.assign(new Error("Invalid runtime process binding."), { status: 400 });
  }
  if (
    typeof input.listenerBindingDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(input.listenerBindingDigest)
    || typeof input.expectedListenerIdentityDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(input.expectedListenerIdentityDigest)
    || (input.attestationMarker !== undefined
      && (typeof input.attestationMarker !== "string" || !/^[a-f0-9]{64}$/.test(input.attestationMarker)))
  ) {
    throw Object.assign(new Error("Runtime adoption proof is invalid."), { status: 400 });
  }
  const existing = sessions.get(input.projectId);
  if (existing?.sessionId === input.sessionId && existing.pid === input.pid) {
    if (existing.stateVersion !== stateVersion) {
      throw Object.assign(new Error("Runtime adoption state version does not match the tracked session."), { status: 409 });
    }
    const canBindUnboundSession =
      existing.listenerBindingDigest === undefined
      && existing.attestationMarker === undefined
      && input.attestationMarker === undefined;
    if (
      (input.attestationMarker ?? null) !== (existing.attestationMarker ?? null)
      || existing.port !== input.port
      || (
        existing.listenerBindingDigest !== undefined
        && input.listenerBindingDigest !== existing.listenerBindingDigest
      )
      || (existing.listenerBindingDigest === undefined && !canBindUnboundSession)
    ) {
      throw Object.assign(new Error("Runtime adoption proof does not match the tracked session."), { status: 409 });
    }
    // A non-attested start cannot bind its listener before the supervisor
    // selects the PID and port. Allow that exact tracked session to bind once,
    // only after the same live-listener and project-root checks as a fresh
    // adoption; never replace a digest that was already established.
    const proof = await verifyRuntimeAdoption(input, projectRoot);
    existing.listenerBindingDigest = input.listenerBindingDigest;
    existing.listenerIdentityDigest = proof.identityDigest;
    return publicSession(existing);
  }
  if (existing && (existing.status === "starting" || existing.status === "running")) {
    throw Object.assign(new Error("A different runtime session already owns this project."), { status: 409 });
  }
  if (!isPidAlive(input.pid) || !(await isPortListening(input.port))) {
    throw Object.assign(new Error("Recorded runtime process is not reachable."), { status: 409 });
  }
  const proof = await verifyRuntimeAdoption(input, projectRoot);
  const session = {
    projectId: input.projectId,
    sessionId: input.sessionId,
    projectRoot,
    stateVersion,
    status: "running",
    port: input.port,
    pid: input.pid,
    logs: [],
    error: null,
    terminationPending: false,
    listenerBindingDigest: input.listenerBindingDigest,
    listenerIdentityDigest: proof.identityDigest,
    ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
  };
  sessions.set(input.projectId, session);
  return publicSession(session);
}

async function stop(input, stateVersion) {
  if (!isSafeProjectId(input.projectId) || !isSafeProjectId(input.sessionId)) {
    throw Object.assign(new Error("Invalid runtime identity."), { status: 400 });
  }
  const session = sessions.get(input.projectId);
  if (!session) {
    throw Object.assign(new Error("No supervisor-owned session is available to stop."), { status: 409 });
  }
  if (session.sessionId !== input.sessionId) {
    throw Object.assign(new Error("Runtime session identity does not match."), { status: 409 });
  }
  if (session.stateVersion !== stateVersion || (input.pid ?? null) !== (session.pid ?? null)) {
    throw Object.assign(new Error("Runtime process identity or state version does not match."), { status: 409 });
  }
  await terminate(session);
  sessions.delete(input.projectId);
  return publicSession(session);
}

async function observeStart(input) {
  if (!isSafeProjectId(input.projectId)) {
    throw Object.assign(new Error("Invalid runtime identity."), { status: 400 });
  }

  const observedAt = new Date().toISOString();
  const managedPorts = Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, index) => PORT_MIN + index);
  const listeningPorts = (await Promise.all(
    managedPorts.map(async (port) => (await isPortListening(port) ? port : null)),
  )).filter((port) => port !== null);
  const liveSessions = new Map();
  for (const session of sessions.values()) {
    if (
      session.status === "running"
      && isPidAlive(session.pid)
      && Number.isInteger(session.port)
      && listeningPorts.includes(session.port)
    ) {
      liveSessions.set(session.port, session);
    }
  }
  const unknownListenerPorts = listeningPorts.filter((port) => !liveSessions.has(port));
  const targetSession = liveSessions.get(
    [...liveSessions.values()].find((session) => session.projectId === input.projectId)?.port,
  );
  const targetIsLive = targetSession?.projectId === input.projectId;
  const targetHasUncorroboratedActiveSession = Array.from(sessions.values()).some(
    (session) => session.projectId === input.projectId
      && (session.status === "starting" || session.status === "running")
      && !targetIsLive,
  );
  let status = "unknown";
  if (targetIsLive) status = "running";
  else if (!targetHasUncorroboratedActiveSession && unknownListenerPorts.length === 0) status = "stopped";

  return {
    projectId: input.projectId,
    status,
    ...(targetIsLive ? { session: publicSession(targetSession) } : {}),
    observedAt,
    inventoryComplete: true,
    unknownListenerPorts,
    detail: status === "running"
      ? "A tracked runtime session is live."
      : status === "stopped"
        ? "No tracked runtime session is live and all managed ports are accounted for."
        : targetHasUncorroboratedActiveSession
          ? "A target runtime session exists but its process and port state could not be corroborated."
          : unknownListenerPorts.length > 0
            ? "Unowned listeners prevent a complete runtime ownership observation."
            : "Runtime port ownership could not be established.",
  };
}

function expectedProcessIdentity(action, input) {
  if (action === "adopt") return {
    pid: input.pid,
    port: input.port,
    listenerIdentityDigest: input.expectedListenerIdentityDigest,
  };
  if (action === "stop") return { pid: input.pid ?? null };
  return null;
}

function equalProcessIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function withReplayLedgerLock(operation) {
  const previous = replayWriteTail;
  let release;
  replayWriteTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); }
  finally { release(); }
}

async function loadReplayLedger() {
  let info;
  try { info = await lstat(REPLAY_LEDGER_PATH); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (info && (
    !info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0
  )) throw new Error("Supervisor replay ledger ownership or permissions are unsafe.");
  if (info) {
    const text = await readFile(REPLAY_LEDGER_PATH, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); }
      catch { throw new Error("Supervisor replay ledger is corrupt."); }
      if (
        !record || typeof record.commandId !== "string" || typeof record.nonce !== "string"
        || !Number.isSafeInteger(record.expiresAt)
      ) throw new Error("Supervisor replay ledger is corrupt.");
      if (record.expiresAt >= Date.now()) {
        consumedCommandIds.set(record.commandId, record);
        consumedNonces.add(record.nonce);
      }
    }
  }
  const handle = await open(REPLAY_LEDGER_PATH, "a", 0o600);
  try { await handle.chmod(0o600); await handle.sync(); }
  finally { await handle.close(); }
}

async function compactReplayLedger() {
  const live = [...consumedCommandIds.values()].filter((record) => record.expiresAt >= Date.now());
  const temporary = `${REPLAY_LEDGER_PATH}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    for (const record of live) await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, REPLAY_LEDGER_PATH);
  consumedCommandIds.clear();
  consumedNonces.clear();
  for (const record of live) {
    consumedCommandIds.set(record.commandId, record);
    consumedNonces.add(record.nonce);
  }
  replayRecordsSinceCompaction = 0;
}

async function consumeSupervisorCommand(command) {
  await withReplayLedgerLock(async () => {
    if (consumedCommandIds.has(command.commandId) || consumedNonces.has(command.nonce)) {
      throw Object.assign(new Error("Supervisor command was already consumed."), { status: 409 });
    }
    if (consumedCommandIds.size >= 100_000) await compactReplayLedger();
    const record = { commandId: command.commandId, nonce: command.nonce, expiresAt: command.expiresAt };
    const handle = await open(REPLAY_LEDGER_PATH, "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    consumedCommandIds.set(record.commandId, record);
    consumedNonces.add(record.nonce);
    replayRecordsSinceCompaction += 1;
    if (replayRecordsSinceCompaction >= 512) await compactReplayLedger();
  });
}

async function authenticateControlRequest(req, action, input, rawBody) {
  const encodedCommand = req.headers["x-eos-command"];
  const signature = req.headers["x-eos-signature"];
  if (typeof encodedCommand !== "string" || typeof signature !== "string") {
    throw Object.assign(new Error("Signed supervisor command is required."), { status: 401 });
  }
  const command = verifyWorkspaceRuntimeSupervisorCommand({
    encodedCommand, signature, publicKey: SUPERVISOR_VERIFY_PUBLIC_KEY, body: rawBody,
  });
  const expectedSession = action === "observe-start" ? null : input.sessionId;
  if (
    command.action !== action
    || command.projectId !== input.projectId
    || command.sessionId !== expectedSession
    || !equalProcessIdentity(command.processIdentity, expectedProcessIdentity(action, input))
  ) throw Object.assign(new Error("Supervisor command scope does not match the request."), { status: 403 });
  if (!isSafeProjectId(input.projectId)) {
    throw Object.assign(new Error("Invalid project identity."), { status: 400 });
  }
  if (action !== "observe-start" && !isSafeProjectId(input.sessionId)) {
    throw Object.assign(new Error("Invalid session identity."), { status: 400 });
  }
  await consumeSupervisorCommand(command);
  return command;
}

async function handle(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    const url = new URL(req.url, "http://workspace-runtime-supervisor.invalid");
    const actions = new Map([
      ["/runtime/start", "start"], ["/runtime/adopt", "adopt"],
      ["/runtime/stop", "stop"], ["/runtime/observe-start", "observe-start"],
    ]);
    const action = actions.get(url.pathname);
    if (!action) return json(res, 404, { error: "not_found" });
    const request = await requestBody(req);
    const command = await authenticateControlRequest(req, action, request.parsed, request.raw);
    if (action === "start") return json(res, 200, await start(request.parsed, command.stateVersion));
    if (action === "adopt") return json(res, 200, await adopt(request.parsed, command.stateVersion));
    if (action === "stop") return json(res, 200, await stop(request.parsed, command.stateVersion));
    return json(res, 200, await observeStart(request.parsed));
  } catch (error) {
    return json(res, error.status ?? 500, { error: bounded(error.message ?? "Supervisor operation failed.") });
  }
}

async function validateControlSocketDirectory() {
  const resolvedDirectory = await realpath(CONTROL_DIRECTORY);
  if (resolvedDirectory !== path.resolve(CONTROL_DIRECTORY)) {
    throw new Error("Supervisor control directory must be canonical and must not contain symlinks.");
  }
  const directory = await stat(resolvedDirectory);
  if (
    !directory.isDirectory()
    || directory.uid !== process.getuid()
    || directory.gid !== API_GID
    || (directory.mode & 0o777) !== 0o710
  ) throw new Error("Supervisor control directory must be owned by the runner and API group with mode 0710.");
  try {
    await lstat(SOCKET_PATH);
    throw new Error("Supervisor socket path already exists; stale sockets must be removed by the host operator.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

function validateCandidateLauncher() {
  if (TEST_MODE) return;
  const probe = spawnSync(SETPRIV_PATH, [
    "--reuid", String(CANDIDATE_UID),
    "--regid", String(CANDIDATE_GID),
    "--clear-groups",
    "--", process.execPath, "-e",
    "process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups()}))",
  ], { encoding: "utf8", timeout: 5_000 });
  if (probe.error || probe.status !== 0) {
    throw new Error("Supervisor cannot launch Candidate with isolated UID/GID and cleared supplementary groups.");
  }
  let identity;
  try { identity = JSON.parse(probe.stdout); }
  catch { throw new Error("Candidate identity preflight returned invalid output."); }
  if (identity.uid !== CANDIDATE_UID || identity.gid !== CANDIDATE_GID
      || !Array.isArray(identity.groups) || identity.groups.length !== 0) {
    throw new Error("Candidate identity preflight did not establish isolated groups.");
  }
}

async function listenOnControlSocket() {
  await validateControlSocketDirectory();
  validateCandidateLauncher();
  await loadReplayLedger();
  const server = http.createServer((req, res) => { void handle(req, res); });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(SOCKET_PATH, resolve);
  });
  try {
    await chown(SOCKET_PATH, process.getuid(), API_GID);
    await chmod(SOCKET_PATH, 0o660);
    const socketInfo = await lstat(SOCKET_PATH);
    if (!socketInfo.isSocket() || socketInfo.uid !== process.getuid()
        || socketInfo.gid !== API_GID || (socketInfo.mode & 0o777) !== 0o660) {
      throw new Error("Supervisor Unix socket ownership or permissions could not be verified.");
    }
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    await unlink(SOCKET_PATH).catch(() => undefined);
    throw error;
  }
  console.log(`Workspace runtime supervisor listening on unix:${SOCKET_PATH}`);
  return server;
}

const server = await listenOnControlSocket();
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const cleanup = Promise.allSettled([...sessions.values()].map((session) => terminate(session)));
  server.close(() => {
    void cleanup.then(async (results) => {
      const failures = results.filter((result) => result.status === "rejected").length;
      if (failures > 0) console.error(`Workspace runtime shutdown could not confirm ${failures} process group(s).`);
      await unlink(SOCKET_PATH).catch(() => undefined);
      process.exit(failures > 0 ? 1 : 0);
    });
  });
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
