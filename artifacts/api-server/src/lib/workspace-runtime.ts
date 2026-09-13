import { promises as fs } from "node:fs";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

const RUNTIME_PORT_MIN = 3000;
const RUNTIME_PORT_MAX = 3099;
const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 2_000;
const MAX_LOG_LINES = 120;
const MAX_LOG_LINE_CHARS = 600;

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
  error: string | null;
  logs: string[];
};

type RuntimeSession = Omit<WorkspaceRuntimeSnapshot, "projectId"> & {
  projectId: string;
  projectRoot: string;
  child: ChildProcess;
  stopPromise?: Promise<void>;
};

export class WorkspaceRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "PROJECT_ROOT_UNAVAILABLE"
      | "DEV_SCRIPT_MISSING"
      | "NO_RUNTIME_PORT"
      | "RUNTIME_START_FAILED"
      | "RUNTIME_STOP_FAILED",
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

async function waitForTcpPort(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new WorkspaceRuntimeError(
        `The development process exited before opening port ${port}.`,
        "RUNTIME_START_FAILED",
        502,
      );
    }
    const connected = await new Promise<boolean>((resolve) => {
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
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new WorkspaceRuntimeError(
    `The development process did not open port ${port} within ${STARTUP_TIMEOUT_MS}ms.`,
    "RUNTIME_START_FAILED",
    502,
  );
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null) return;
  try {
    if (child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export class WorkspaceRuntimeManager {
  private readonly sessions = new Map<string, RuntimeSession>();

  async get(projectId: string): Promise<WorkspaceRuntimeSnapshot> {
    const session = this.sessions.get(projectId);
    return session ? this.snapshot(session) : this.stoppedSnapshot(projectId);
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

    let projectRoot: string;
    try {
      projectRoot = await fs.realpath(input.projectRoot);
      const packageJson = JSON.parse(await fs.readFile(`${projectRoot}/package.json`, "utf8")) as {
        scripts?: Record<string, unknown>;
      };
      if (typeof packageJson.scripts?.dev !== "string" || !packageJson.scripts.dev.trim()) {
        throw new WorkspaceRuntimeError(
          "This project does not define a package.json dev script.",
          "DEV_SCRIPT_MISSING",
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceRuntimeError) throw error;
      throw new WorkspaceRuntimeError(
        "The project root is unavailable or its package.json cannot be read.",
        "PROJECT_ROOT_UNAVAILABLE",
      );
    }

    const port = await findAvailablePort();
    const child = spawn("pnpm", ["run", "dev"], {
      cwd: projectRoot,
      env: runtimeEnv(port),
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const session: RuntimeSession = {
      projectId: input.projectId,
      projectRoot,
      sessionId: randomUUID(),
      status: "starting",
      port,
      command: "pnpm run dev",
      revision: input.revision,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      pid: child.pid ?? null,
      error: null,
      logs: [],
      child,
    };
    this.sessions.set(input.projectId, session);
    this.attachLogs(session);
    child.once("exit", (code, signal) => {
      if (this.sessions.get(input.projectId)?.sessionId !== session.sessionId) return;
      if (session.status === "starting" || session.status === "running") {
        session.status = code === 0 ? "stopped" : "failed";
        session.error = code === 0
          ? null
          : `Development process exited with ${signal ?? `code ${code ?? "unknown"}`}.`;
        session.stoppedAt = new Date().toISOString();
      }
    });

    try {
      await waitForTcpPort(child, port);
      session.status = "running";
      return this.snapshot(session);
    } catch (error) {
      session.status = "failed";
      session.error = bounded(error instanceof Error ? error.message : String(error));
      await this.stopSession(session, "failed");
      return this.snapshot(session);
    }
  }

  async stop(projectId: string): Promise<WorkspaceRuntimeSnapshot> {
    const session = this.sessions.get(projectId);
    if (!session) return this.stoppedSnapshot(projectId);
    await this.stopSession(session);
    return this.snapshot(session);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.stopSession(session)));
    this.sessions.clear();
  }

  private attachLogs(session: RuntimeSession): void {
    const append = (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const safeLine = bounded(line);
        if (!safeLine) continue;
        session.logs.push(safeLine);
        if (session.logs.length > MAX_LOG_LINES) session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
      }
    };
    session.child.stdout?.on("data", append);
    session.child.stderr?.on("data", append);
  }

  private async stopSession(session: RuntimeSession, finalStatus: "stopped" | "failed" = "stopped"): Promise<void> {
    if (session.stopPromise) return session.stopPromise;
    session.stopPromise = (async () => {
      if (session.child.exitCode !== null) {
        session.status = finalStatus;
        session.stoppedAt = new Date().toISOString();
        session.pid = null;
        return;
      }
      signalProcessGroup(session.child, "SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          signalProcessGroup(session.child, "SIGKILL");
          resolve();
        }, STOP_TIMEOUT_MS);
        session.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      session.status = finalStatus;
      session.stoppedAt = new Date().toISOString();
      session.pid = null;
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
      error: null,
      logs: [],
    };
  }

  private snapshot(session: RuntimeSession): WorkspaceRuntimeSnapshot {
    const { child: _child, projectRoot: _projectRoot, stopPromise: _stopPromise, ...snapshot } = session;
    return { ...snapshot, logs: [...snapshot.logs] };
  }
}

export const workspaceRuntime = new WorkspaceRuntimeManager();