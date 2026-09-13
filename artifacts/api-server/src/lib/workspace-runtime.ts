import { promises as fs } from "node:fs";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { WorkspaceRuntime } from "@workspace/db";
import {
  createInMemoryWorkspaceRuntimeStore,
  databaseWorkspaceRuntimeStore,
  RUNTIME_LEASE_MS,
  type RuntimeStorePatch,
  type WorkspaceRuntimeStore,
} from "./workspace-runtime-store.js";
import {
  WorkspaceRuntimeSupervisorClient,
  WorkspaceRuntimeSupervisorError,
} from "./workspace-runtime-supervisor-client.js";

const RUNTIME_PORT_MIN = 3000;
const RUNTIME_PORT_MAX = 3099;
const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 2_000;
const MAX_LOG_LINES = 120;
const MAX_LOG_LINE_CHARS = 600;
const HEARTBEAT_INTERVAL_MS = 10_000;

const SAFE_ENV_NAMES = /^(?:PATH|HOME|USER|SHELL|LANG|LC_[A-Z_]+|TERM|TMPDIR|PNPM_HOME|npm_config_[A-Za-z0-9_]+)$/;

export type WorkspaceRuntimeStatus = "stopped" | "starting" | "running" | "failed";

export type WorkspaceRuntimeSnapshot = {
  projectId: string;
  sessionId: string | null;
  status: WorkspaceRuntimeStatus;
  port: number | null;
  command: "pnpm run dev";
  revision: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  pid: number | null;
  leaseUntil: string | null;
  lastHeartbeatAt: string | null;
  error: string | null;
  logs: string[];
};

type RuntimeSession = Omit<WorkspaceRuntimeSnapshot, "projectId" | "sessionId"> & {
  projectId: string;
  sessionId: string;
  projectRoot: string;
  workerId: string;
  child?: ChildProcess;
  stopPromise?: Promise<void>;
  heartbeatTimer?: NodeJS.Timeout;
};

export class WorkspaceRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "PROJECT_ROOT_UNAVAILABLE"
      | "DEV_SCRIPT_MISSING"
      | "NO_RUNTIME_PORT"
      | "RUNTIME_START_FAILED"
      | "RUNTIME_STOP_FAILED"
      | "RUNTIME_OWNERSHIP_BUSY",
    public readonly status = 422,
  ) {
    super(message);
    this.name = "WorkspaceRuntimeError";
  }
}

function bounded(value: string, limit = MAX_LOG_LINE_CHARS): string {
  return value
    .replace(/\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function runtimeEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && SAFE_ENV_NAMES.test(name)) env[name] = value;
  }
  env.NODE_ENV = "development";
  env.PORT = String(port);
  env.BASE_PATH = "/";
  return env;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(): Promise<number> {
  for (let port = RUNTIME_PORT_MIN; port <= RUNTIME_PORT_MAX; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new WorkspaceRuntimeError(
    "No development preview port is available in the managed runtime range.",
    "NO_RUNTIME_PORT",
    503,
  );
}

async function isPidAlive(pid: number | null): Promise<boolean> {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function isPortListening(port: number | null): Promise<boolean> {
  if (!port) return false;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
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

async function waitForExistingPort(port: number | null, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return isPortListening(port);
}

async function waitForTcpPort(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let processError: Error | undefined;
  const onError = (error: Error) => { processError = error; };
  child.once("error", onError);
  while (Date.now() < deadline) {
    if (processError) {
      child.off("error", onError);
      throw new WorkspaceRuntimeError(
        `The development process could not start: ${bounded(processError.message)}.`,
        "RUNTIME_START_FAILED",
        502,
      );
    }
    if (child.exitCode !== null) {
      child.off("error", onError);
      throw new WorkspaceRuntimeError(
        `The development process exited before opening port ${port}.`,
        "RUNTIME_START_FAILED",
        502,
      );
    }
    if (await isPortListening(port)) {
      child.off("error", onError);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.off("error", onError);
  throw new WorkspaceRuntimeError(
    `The development process did not open port ${port} within ${STARTUP_TIMEOUT_MS}ms.`,
    "RUNTIME_START_FAILED",
    502,
  );
}

function signalProcessGroup(pid: number | null, child: ChildProcess | undefined, signal: NodeJS.Signals): void {
  if (!pid && !child) return;
  try {
    if (pid) process.kill(-pid, signal);
    else child?.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function terminateProcessGroup(pid: number | null, child: ChildProcess | undefined): Promise<void> {
  signalProcessGroup(pid, child, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline && await isPidAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (await isPidAlive(pid)) signalProcessGroup(pid, child, "SIGKILL");
}

function rowSnapshot(row: WorkspaceRuntime): WorkspaceRuntimeSnapshot {
  return {
    projectId: row.projectId,
    sessionId: row.sessionId,
    status: row.status,
    port: row.port,
    command: "pnpm run dev",
    revision: row.revision,
    startedAt: row.startedAt?.toISOString() ?? null,
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    pid: row.pid,
    leaseUntil: row.leaseUntil?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    error: row.error,
    logs: [...row.logs],
  };
}

function sessionFromRow(
  row: WorkspaceRuntime,
  workerId: string,
  logs = row.logs,
): RuntimeSession {
  return {
    ...rowSnapshot(row),
    sessionId: row.sessionId,
    projectRoot: row.projectRoot,
    workerId,
    logs: [...logs],
  };
}

export class WorkspaceRuntimeManager {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly store: WorkspaceRuntimeStore;
  private readonly workerId: string;
  private readonly supervisor?: WorkspaceRuntimeSupervisorClient;

  constructor(options?: {
    store?: WorkspaceRuntimeStore;
    workerId?: string;
    supervisor?: WorkspaceRuntimeSupervisorClient;
  }) {
    this.store = options?.store ?? createInMemoryWorkspaceRuntimeStore();
    this.workerId = options?.workerId ?? `runtime-worker:${randomUUID()}`;
    this.supervisor = options?.supervisor;
  }

  async get(projectId: string): Promise<WorkspaceRuntimeSnapshot> {
    const session = this.sessions.get(projectId);
    if (session) return this.snapshot(session);
    const persisted = await this.store.get(projectId);
    return persisted ? rowSnapshot(persisted) : this.stoppedSnapshot(projectId);
  }

  async recover(): Promise<void> {
    const rows = await this.store.listRecoverable(new Date());
    for (const row of rows) {
      const claimed = await this.store.claimRecovery({
        id: row.id,
        workerId: this.workerId,
        now: new Date(),
        leaseUntil: new Date(Date.now() + RUNTIME_LEASE_MS),
      });
      if (!claimed) continue;
      let processAlive = await isPidAlive(claimed.pid);
      let portReady = processAlive && await waitForExistingPort(claimed.port, 5_000);
      let adoptedLogs: string[] | undefined;
      if (this.supervisor && processAlive && portReady) {
        try {
          const adopted = await this.supervisor.adopt({
            projectId: claimed.projectId,
            sessionId: claimed.sessionId,
            projectRoot: claimed.projectRoot,
            pid: claimed.pid,
            port: claimed.port,
          });
          adoptedLogs = adopted.logs;
          processAlive = adopted.pid !== null;
          portReady = adopted.port !== null;
        } catch (error) {
          if (error instanceof WorkspaceRuntimeSupervisorError && error.status === 503) {
            await this.store.updateOwned(claimed.projectId, this.workerId, {
              workerId: null,
              leaseUntil: null,
              lastHeartbeatAt: null,
            });
            continue;
          }
          processAlive = false;
          portReady = false;
        }
      }
      if (!processAlive || !portReady) {
        if (await isPidAlive(claimed.pid)) await terminateProcessGroup(claimed.pid, undefined);
        await this.store.updateOwned(claimed.projectId, this.workerId, {
          status: "failed",
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
          stoppedAt: new Date(),
          error: "Runtime process was not reachable during recovery.",
        });
        continue;
      }
      const existing = this.sessions.get(claimed.projectId);
      if (existing?.sessionId === claimed.sessionId) {
        existing.leaseUntil = claimed.leaseUntil?.toISOString() ?? null;
        existing.lastHeartbeatAt = claimed.lastHeartbeatAt?.toISOString() ?? null;
        if (adoptedLogs) existing.logs = [...adoptedLogs];
        this.startHeartbeat(existing);
        continue;
      }
      const session = sessionFromRow(claimed, this.workerId, adoptedLogs ?? claimed.logs);
      this.sessions.set(claimed.projectId, session);
      this.startHeartbeat(session);
    }
  }

  async start(input: {
    projectId: string;
    projectRoot: string;
    revision: string;
    restart?: boolean;
  }): Promise<WorkspaceRuntimeSnapshot> {
    const current = this.sessions.get(input.projectId);
    if (current && !input.restart && (current.status === "starting" || current.status === "running")) {
      return this.snapshot(current);
    }
    if (current) await this.stop(input.projectId);

    const projectRoot = await this.validateProjectRoot(input.projectRoot);
    const directPort = this.supervisor ? null : await findAvailablePort();
    const now = new Date();
    const sessionId = randomUUID();
    const persisted = await this.store.begin({
      projectId: input.projectId,
      projectRoot,
      sessionId,
      revision: input.revision,
      workerId: this.workerId,
      now,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS),
    });
    if (!persisted) {
      const existing = await this.store.get(input.projectId);
      if (existing) return rowSnapshot(existing);
      throw new WorkspaceRuntimeError(
        "Another runtime worker currently owns this project.",
        "RUNTIME_OWNERSHIP_BUSY",
        409,
      );
    }

    let child: ChildProcess | undefined;
    let supervised: Awaited<ReturnType<WorkspaceRuntimeSupervisorClient["start"]>> | undefined;
    try {
      if (this.supervisor) {
        supervised = await this.supervisor.start({
          projectId: input.projectId,
          sessionId,
          projectRoot,
        });
      } else {
        child = spawn("pnpm", ["run", "dev"], {
          cwd: projectRoot,
          env: runtimeEnv(directPort!),
          detached: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } catch (error) {
      const message = bounded(error instanceof Error ? error.message : String(error));
      await this.store.updateOwned(input.projectId, this.workerId, {
        status: "failed",
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        stoppedAt: new Date(),
        error: message,
      });
      throw new WorkspaceRuntimeError(message, "RUNTIME_START_FAILED", 502);
    }
    const port = supervised?.port ?? directPort;
    const pid = supervised?.pid ?? child?.pid ?? null;
    if (!port) {
      await this.store.updateOwned(input.projectId, this.workerId, {
        status: "failed",
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        stoppedAt: new Date(),
        error: "Runtime supervisor returned no listening port.",
      });
      throw new WorkspaceRuntimeError(
        "Runtime supervisor returned no listening port.",
        "RUNTIME_START_FAILED",
        502,
      );
    }
    const session: RuntimeSession = {
      projectId: input.projectId,
      projectRoot,
      workerId: this.workerId,
      sessionId,
      status: "starting",
      port,
      command: "pnpm run dev",
      revision: input.revision,
      startedAt: now.toISOString(),
      stoppedAt: null,
      pid,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS).toISOString(),
      lastHeartbeatAt: now.toISOString(),
      error: null,
      logs: supervised?.logs ?? [],
      child,
    };
    this.sessions.set(input.projectId, session);
    await this.store.updateOwned(input.projectId, this.workerId, {
      port,
      pid,
      logs: session.logs,
    });
    if (child) this.attachLogs(session);
    this.startHeartbeat(session);
    child?.once("exit", (code, signal) => {
      if (this.sessions.get(input.projectId)?.sessionId !== session.sessionId) return;
      if (session.status === "starting" || session.status === "running") {
        session.status = code === 0 ? "stopped" : "failed";
        session.error = code === 0
          ? null
          : `Development process exited with ${signal ?? `code ${code ?? "unknown"}`}.`;
        session.stoppedAt = new Date().toISOString();
        void this.store.updateOwned(input.projectId, this.workerId, {
          status: session.status,
          pid: null,
          stoppedAt: new Date(),
          error: session.error,
          leaseUntil: null,
          lastHeartbeatAt: null,
          workerId: null,
          logs: session.logs,
        });
        this.stopHeartbeat(session);
      }
    });

    try {
      if (this.supervisor) {
        if (supervised?.status !== "running") {
          throw new WorkspaceRuntimeError(
            supervised?.error ?? "Runtime supervisor did not reach running state.",
            "RUNTIME_START_FAILED",
            502,
          );
        }
      } else {
        await waitForTcpPort(child!, port);
      }
      session.status = "running";
      await this.persist(session, { status: "running" });
      return this.snapshot(session);
    } catch (error) {
      session.status = "failed";
      session.error = bounded(error instanceof Error ? error.message : String(error));
      await this.stopSession(session, "failed");
      return this.snapshot(session);
    }
  }

  async stop(projectId: string): Promise<WorkspaceRuntimeSnapshot> {
    let session = this.sessions.get(projectId);
    if (!session) {
      const persisted = await this.store.get(projectId);
      if (!persisted) return this.stoppedSnapshot(projectId);
      const claimed = await this.store.claimRecovery({
        id: persisted.id,
        workerId: this.workerId,
        now: new Date(),
        leaseUntil: new Date(Date.now() + RUNTIME_LEASE_MS),
      });
      if (!claimed) return rowSnapshot(persisted);
      const adopted = sessionFromRow(claimed, this.workerId);
      this.sessions.set(projectId, adopted);
      this.startHeartbeat(adopted);
      session = adopted;
    }
    const activeSession = session;
    await this.stopSession(activeSession);
    return this.snapshot(activeSession);
  }

  /**
   * Graceful API replacement releases durable ownership but intentionally does
   * not kill the detached project process. The next API worker can adopt it.
   */
  async shutdown(options: { preserveProcesses?: boolean } = {}): Promise<void> {
    for (const session of this.sessions.values()) this.stopHeartbeat(session);
    if (options.preserveProcesses) {
      await this.store.releaseWorker(this.workerId);
      this.sessions.clear();
      return;
    }
    await Promise.all([...this.sessions.values()].map((session) => this.stopSession(session)));
    await this.store.releaseWorker(this.workerId);
    this.sessions.clear();
  }

  private async validateProjectRoot(candidate: string): Promise<string> {
    try {
      const projectRoot = await fs.realpath(candidate);
      const packageJson = JSON.parse(await fs.readFile(`${projectRoot}/package.json`, "utf8")) as {
        scripts?: Record<string, unknown>;
      };
      if (typeof packageJson.scripts?.dev !== "string" || !packageJson.scripts.dev.trim()) {
        throw new WorkspaceRuntimeError(
          "This project does not define a package.json dev script.",
          "DEV_SCRIPT_MISSING",
        );
      }
      return projectRoot;
    } catch (error) {
      if (error instanceof WorkspaceRuntimeError) throw error;
      throw new WorkspaceRuntimeError(
        "The project root is unavailable or its package.json cannot be read.",
        "PROJECT_ROOT_UNAVAILABLE",
      );
    }
  }

  private attachLogs(session: RuntimeSession): void {
    const append = (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const safeLine = bounded(line);
        if (!safeLine) continue;
        session.logs.push(safeLine);
        if (session.logs.length > MAX_LOG_LINES) session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
      }
      void this.persist(session, { logs: session.logs });
    };
    session.child?.stdout?.on("data", append);
    session.child?.stderr?.on("data", append);
  }

  private startHeartbeat(session: RuntimeSession): void {
    this.stopHeartbeat(session);
    session.heartbeatTimer = setInterval(() => {
      void this.heartbeat(session);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(session: RuntimeSession): void {
    if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = undefined;
  }

  private async heartbeat(session: RuntimeSession): Promise<void> {
    if (!this.sessions.has(session.projectId)) return;
    if (this.supervisor && session.pid && session.port) {
      try {
        await this.supervisor.adopt({
          projectId: session.projectId,
          sessionId: session.sessionId,
          projectRoot: session.projectRoot,
          pid: session.pid,
          port: session.port,
        });
      } catch (error) {
        if (error instanceof WorkspaceRuntimeSupervisorError && error.status === 503) return;
        this.stopHeartbeat(session);
        await this.store.updateOwned(session.projectId, this.workerId, {
          status: "failed",
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
          stoppedAt: new Date(),
          error: "Runtime supervisor could not re-adopt the process.",
        });
        this.sessions.delete(session.projectId);
        return;
      }
    }
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + RUNTIME_LEASE_MS);
    const owned = await this.store.updateOwned(session.projectId, this.workerId, {
      leaseUntil,
      lastHeartbeatAt: now,
    });
    if (!owned) {
      this.stopHeartbeat(session);
      if (session.child || session.pid) await this.stopSession(session);
    } else {
      session.leaseUntil = leaseUntil.toISOString();
      session.lastHeartbeatAt = now.toISOString();
    }
  }

  private async persist(session: RuntimeSession, patch: RuntimeStorePatch): Promise<void> {
    const updated = await this.store.updateOwned(session.projectId, this.workerId, patch);
    if (!updated) {
      this.stopHeartbeat(session);
      return;
    }
    if (patch.status) session.status = patch.status;
    if (patch.error !== undefined) session.error = patch.error;
    if (patch.logs) session.logs = [...patch.logs];
  }

  private async stopSession(session: RuntimeSession, finalStatus: "stopped" | "failed" = "stopped"): Promise<void> {
    if (session.stopPromise) return session.stopPromise;
    session.stopPromise = (async () => {
      this.stopHeartbeat(session);
      if (this.supervisor) {
        await this.supervisor.stop({
          projectId: session.projectId,
          sessionId: session.sessionId,
          pid: session.pid,
        });
      } else {
        await terminateProcessGroup(session.pid, session.child);
      }
      session.status = finalStatus;
      session.stoppedAt = new Date().toISOString();
      session.pid = null;
      session.leaseUntil = null;
      session.lastHeartbeatAt = null;
      await this.store.updateOwned(session.projectId, this.workerId, {
        status: finalStatus,
        pid: null,
        stoppedAt: new Date(),
        leaseUntil: null,
        lastHeartbeatAt: null,
        workerId: null,
        error: session.error,
        logs: session.logs,
      });
    })();
    return session.stopPromise;
  }

  private stoppedSnapshot(projectId: string): WorkspaceRuntimeSnapshot {
    return {
      projectId,
      sessionId: null,
      status: "stopped",
      port: null,
      command: "pnpm run dev",
      revision: null,
      startedAt: null,
      stoppedAt: null,
      pid: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
      error: null,
      logs: [],
    };
  }

  private snapshot(session: RuntimeSession): WorkspaceRuntimeSnapshot {
    const { child: _child, projectRoot: _projectRoot, workerId: _workerId, stopPromise: _stopPromise, heartbeatTimer: _heartbeatTimer, ...snapshot } = session;
    return { ...snapshot, logs: [...snapshot.logs] };
  }
}

export const workspaceRuntime = new WorkspaceRuntimeManager({
  store: databaseWorkspaceRuntimeStore,
  supervisor: new WorkspaceRuntimeSupervisorClient(),
});