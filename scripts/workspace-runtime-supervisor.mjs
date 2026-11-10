import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";

const BIND_HOST = process.env.WORKSPACE_RUNTIME_SUPERVISOR_HOST ?? "127.0.0.1";
const LOOPBACK_HOST = "127.0.0.1";
const PORT = Number(process.env.WORKSPACE_RUNTIME_SUPERVISOR_PORT ?? 8099);
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
const SAFE_ENV_NAMES = /^(?:PATH|HOME|USER|SHELL|LANG|LC_[A-Z_]+|TERM|TMPDIR|PNPM_HOME|npm_config_[A-Za-z0-9_]+)$/;
const SUPERVISOR_AUTH_CONTEXT = "EngineeringOS/workspace-runtime-supervisor/v1";
const CHILD_ATTESTATION_ENV_NAME = "ENGINEERINGOS_CHILD_ATTESTATION";
const sessions = new Map();
const startLocks = new Map();
const reservedRuntimePorts = new Set();
let portReservationTail = Promise.resolve();

if (BIND_HOST !== "127.0.0.1") {
  throw new Error("Workspace runtime supervisor must bind to a loopback address.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("Workspace runtime supervisor port is invalid.");
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("Workspace runtime supervisor authentication is not configured.");
}
const SUPERVISOR_AUTH_TOKEN = createHmac("sha256", sessionSecret)
  .update(SUPERVISOR_AUTH_CONTEXT)
  .digest("hex");

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

function isAuthorized(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(SUPERVISOR_AUTH_TOKEN, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function body(req) {
  let content = "";
  for await (const chunk of req) content += chunk;
  if (content.length > 32_000) throw new Error("Request body is too large.");
  return content ? JSON.parse(content) : {};
}

function isSafeProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,200}$/.test(value);
}

function runtimeEnv(port, attestationMarker) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && SAFE_ENV_NAMES.test(name)) env[name] = value;
  }
  env.NODE_ENV = "development";
  env.PORT = String(port);
  env.BASE_PATH = "/";
  if (attestationMarker) env.ENGINEERINGOS_CHILD_ATTESTATION = attestationMarker;
  return env;
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
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw Object.assign(new Error("A canonical registered project root is required."), { status: 400 });
  }
  let resolved;
  try {
    resolved = await realpath(candidate);
    if (resolved !== path.resolve(candidate) || !(await stat(resolved)).isDirectory()) {
      throw new Error("Project root is not canonical.");
    }
    const manifest = JSON.parse(await readFile(path.join(resolved, "package.json"), "utf8"));
    if (typeof manifest.scripts?.dev !== "string" || !manifest.scripts.dev.trim()) {
      throw new Error("Project dev script is unavailable.");
    }
  } catch {
    throw Object.assign(new Error("The registered project root is unavailable or invalid."), { status: 400 });
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

async function start(input) {
  const previous = startLocks.get(input.projectId) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  startLocks.set(input.projectId, current);
  await previous;
  try {
    return await startExclusive(input);
  } finally {
    release();
    if (startLocks.get(input.projectId) === current) startLocks.delete(input.projectId);
  }
}

async function startExclusive(input) {
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
        (input.attestationMarker ?? null) !== (existing.attestationMarker ?? null)
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
    child = spawn("pnpm", ["run", "dev"], {
      cwd: projectRoot,
      env: runtimeEnv(port, input.attestationMarker),
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    reservedRuntimePorts.delete(port);
    throw error;
  }
  const session = {
    projectId: input.projectId,
    sessionId: input.sessionId,
    projectRoot,
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

async function adopt(input) {
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
    if (
      (input.attestationMarker ?? null) !== (existing.attestationMarker ?? null)
      || input.listenerBindingDigest !== existing.listenerBindingDigest
    ) {
      throw Object.assign(new Error("Runtime adoption proof does not match the tracked session."), { status: 409 });
    }
    const proof = await verifyRuntimeAdoption(input, projectRoot);
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

async function stop(input) {
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
  const portOwnershipComplete = unknownListenerPorts.length === 0;
  let status = "unknown";
  if (targetIsLive && portOwnershipComplete) status = "running";
  else if (!targetHasUncorroboratedActiveSession && portOwnershipComplete) status = "stopped";

  return {
    projectId: input.projectId,
    status,
    ...(status === "running" ? { session: publicSession(targetSession) } : {}),
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

async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://${LOOPBACK_HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { status: "ok" });
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    if (!isAuthorized(req)) return json(res, 401, { error: "unauthorized" });
    const input = await body(req);
    if (url.pathname === "/runtime/start") return json(res, 200, await start(input));
    if (url.pathname === "/runtime/adopt") return json(res, 200, await adopt(input));
    if (url.pathname === "/runtime/stop") return json(res, 200, await stop(input));
    if (url.pathname === "/runtime/observe-start") return json(res, 200, await observeStart(input));
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, error.status ?? 500, { error: bounded(error.message ?? "Supervisor operation failed.") });
  }
}

const server = http.createServer((req, res) => { void handle(req, res); });
server.listen(PORT, BIND_HOST, () => {
  console.log(`Workspace runtime supervisor listening on ${BIND_HOST}:${PORT}`);
});

function shutdown() {
  const cleanup = Promise.allSettled(
    [...sessions.values()].map((session) => terminate(session)),
  );
  server.close(() => {
    void cleanup.then((results) => {
      const failures = results.filter((result) => result.status === "rejected").length;
      if (failures > 0) {
        console.error(`Workspace runtime shutdown could not confirm ${failures} process group(s).`);
      }
      process.exit(0);
    });
  });
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);