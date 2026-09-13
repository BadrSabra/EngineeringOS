import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = Number(process.env.WORKSPACE_RUNTIME_SUPERVISOR_PORT ?? 8099);
const PORT_MIN = 3000;
const PORT_MAX = 3099;
const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 2_000;
const MAX_LOG_LINES = 120;
const MAX_LOG_LINE_CHARS = 600;
const SAFE_ENV_NAMES = /^(?:PATH|HOME|USER|SHELL|LANG|LC_[A-Z_]+|TERM|TMPDIR|PNPM_HOME|npm_config_[A-Za-z0-9_]+)$/;
const sessions = new Map();

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

async function body(req) {
  let content = "";
  for await (const chunk of req) content += chunk;
  if (content.length > 32_000) throw new Error("Request body is too large.");
  return content ? JSON.parse(content) : {};
}

function isSafeProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,200}$/.test(value);
}

function runtimeEnv(port) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && SAFE_ENV_NAMES.test(name)) env[name] = value;
  }
  env.NODE_ENV = "development";
  env.PORT = String(port);
  env.BASE_PATH = "/";
  return env;
}

function isPortListening(port) {
  if (!Number.isInteger(port)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
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

async function findPort() {
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen({ host: HOST, port }, () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error("No managed runtime port is available.");
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function signalGroup(pid, signal) {
  if (!Number.isInteger(pid)) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function terminate(session) {
  signalGroup(session.pid, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline && isPidAlive(session.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (isPidAlive(session.pid)) signalGroup(session.pid, "SIGKILL");
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
    logs: [...session.logs],
    error: session.error ?? null,
  };
}

async function start(input) {
  if (!isSafeProjectId(input.projectId) || !isSafeProjectId(input.sessionId)) {
    throw Object.assign(new Error("Invalid runtime identity."), { status: 400 });
  }
  if (input.profile !== "dev" || typeof input.projectRoot !== "string" || !input.projectRoot.startsWith("/")) {
    throw Object.assign(new Error("Only the server-owned dev profile is permitted."), { status: 400 });
  }
  const existing = sessions.get(input.projectId);
  if (existing && (existing.status === "starting" || existing.status === "running")) {
    if (existing.sessionId === input.sessionId) return publicSession(existing);
    throw Object.assign(new Error("A different runtime session already owns this project."), { status: 409 });
  }
  if (existing) await terminate(existing);
  const port = await findPort();
  const child = spawn("pnpm", ["run", "dev"], {
    cwd: input.projectRoot,
    env: runtimeEnv(port),
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const session = {
    projectId: input.projectId,
    sessionId: input.sessionId,
    projectRoot: input.projectRoot,
    status: "starting",
    port,
    pid: child.pid ?? null,
    logs: [],
    error: null,
    child,
  };
  sessions.set(input.projectId, session);
  attachLogs(session);
  child.once("exit", (code, signal) => {
    if (sessions.get(input.projectId)?.sessionId !== session.sessionId) return;
    if (session.status === "starting" || session.status === "running") {
      session.status = code === 0 ? "stopped" : "failed";
      session.error = code === 0 ? null : `Runtime exited with ${signal ?? `code ${code ?? "unknown"}`}.`;
    }
  });
  try {
    await waitForReady(child, port);
    session.status = "running";
    return publicSession(session);
  } catch (error) {
    session.status = "failed";
    session.error = bounded(error.message);
    await terminate(session);
    session.status = "failed";
    return publicSession(session);
  }
}

async function adopt(input) {
  if (!isSafeProjectId(input.projectId) || !isSafeProjectId(input.sessionId)) {
    throw Object.assign(new Error("Invalid runtime identity."), { status: 400 });
  }
  if (!isPidAlive(input.pid) || !(await isPortListening(input.port))) {
    throw Object.assign(new Error("Recorded runtime process is not reachable."), { status: 409 });
  }
  const session = {
    projectId: input.projectId,
    sessionId: input.sessionId,
    projectRoot: input.projectRoot,
    status: "running",
    port: input.port,
    pid: input.pid,
    logs: [],
    error: null,
  };
  sessions.set(input.projectId, session);
  return publicSession(session);
}

async function stop(input) {
  const session = sessions.get(input.projectId);
  if (!session) {
    if (isPidAlive(input.pid)) signalGroup(input.pid, "SIGTERM");
    return { projectId: input.projectId, sessionId: input.sessionId, status: "stopped", port: null, pid: null, logs: [], error: null };
  }
  if (session.sessionId !== input.sessionId) {
    throw Object.assign(new Error("Runtime session identity does not match."), { status: 409 });
  }
  await terminate(session);
  sessions.delete(input.projectId);
  return publicSession(session);
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { status: "ok" });
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    const input = await body(req);
    if (url.pathname === "/runtime/start") return json(res, 200, await start(input));
    if (url.pathname === "/runtime/adopt") return json(res, 200, await adopt(input));
    if (url.pathname === "/runtime/stop") return json(res, 200, await stop(input));
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, error.status ?? 500, { error: bounded(error.message ?? "Supervisor operation failed.") });
  }
}

const server = http.createServer((req, res) => { void handle(req, res); });
server.listen(PORT, HOST, () => {
  console.log(`Workspace runtime supervisor listening on ${HOST}:${PORT}`);
});

function shutdown() {
  for (const session of sessions.values()) signalGroup(session.pid, "SIGTERM");
  server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);