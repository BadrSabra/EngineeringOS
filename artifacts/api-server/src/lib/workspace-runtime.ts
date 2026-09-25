import { promises as fs } from "node:fs";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { WorkspaceRuntime } from "@workspace/db";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./agent-state/environment-attestation.js";
import {
  attestChildProcessEnvironment,
  childProcessBindingDigest,
  CHILD_ATTESTATION_ENV_NAME,
  type ChildProcessAttestationBinding,
  type ChildProcessAttestationIdentity,
  type ChildProcessEnvironmentAttestation,
} from "./agent-state/child-process-attestation.js";
import { resolveRuntimeListenerProcess } from "./agent-state/runtime-listener-process.js";
import {
  createInMemoryWorkspaceRuntimeStore,
  databaseWorkspaceRuntimeStore,
  RUNTIME_LEASE_MS,
  type RuntimeStorePatch,
  type WorkspaceRuntimeStore,
} from "./workspace-runtime-store.js";
import {
  WorkspaceRuntimeSupervisorClient,
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

export type RuntimeListenerObservation = {
  status: "known" | "mismatch" | "unknown";
  reasonCode: string;
  port: number | null;
  identityDigest: string | null;
  processAttestation: ChildProcessEnvironmentAttestation;
};

export type RuntimeAfterState = {
  status: "passed" | "failed" | "unavailable";
  projectId: string;
  sessionId: string;
  revision: string;
  pid: number | null;
  port: number;
  processAlive: boolean;
  portReady: boolean;
  healthPath: string;
  healthStatus: number | null;
  servingRevision: string | null;
  markerMatched: boolean | null;
  responseBody: string;
  childProcessAttestation?: ChildProcessEnvironmentAttestation;
  listener: RuntimeListenerObservation;
  observedAt: string;
  detail: string;
};

export type WorkspaceRuntimeSnapshot = {
  projectId: string;
  sessionId: string | null;
  status: WorkspaceRuntimeStatus;
  port: number | null;
  command: "pnpm run dev";
  revision: string | null;
  environmentRevision: string | null;
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
  childProcessMarker?: string;
  childProcessBinding?: ChildProcessAttestationBinding;
  heartbeatInFlight?: boolean;
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
      | "RUNTIME_OWNERSHIP_BUSY"
      | "RUNTIME_OBSERVATION_STALE",
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

function runtimeEnv(port: number, childProcessMarker?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && SAFE_ENV_NAMES.test(name)) env[name] = value;
  }
  env.NODE_ENV = "development";
  env.PORT = String(port);
  env.BASE_PATH = "/";
  if (childProcessMarker) env[CHILD_ATTESTATION_ENV_NAME] = childProcessMarker;
  return env;
}

function unknownChildProcessAttestation(
  reasonCode: ChildProcessEnvironmentAttestation["reasonCode"],
  binding?: ChildProcessAttestationBinding,
  observedAt = new Date().toISOString(),
): ChildProcessEnvironmentAttestation {
  return {
    status: "unknown",
    reasonCode,
    bindingDigest: binding ? childProcessBindingDigest(binding) : null,
    attestationDigest: null,
    processEnvironmentDigest: null,
    observedAt,
  };
}

function unknownRuntimeListenerObservation(
  reasonCode: string,
  binding?: ChildProcessAttestationBinding,
  processReason: ChildProcessEnvironmentAttestation["reasonCode"] = "procfs_unavailable",
  observedAt = new Date().toISOString(),
): RuntimeListenerObservation {
  const listenerBinding = binding
    ? { ...binding, processRole: "runtime_listener" as const }
    : undefined;
  return {
    status: "unknown",
    reasonCode,
    port: null,
    identityDigest: null,
    processAttestation: unknownChildProcessAttestation(
      processReason,
      listenerBinding,
      observedAt,
    ),
  };
}

function sameAttestationBinding(
  left: ChildProcessAttestationBinding,
  right: ChildProcessAttestationBinding,
): boolean {
  return childProcessBindingDigest(left) === childProcessBindingDigest(right);
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
    environmentRevision: row.environmentRevision,
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
  private readonly listenerResolver: typeof resolveRuntimeListenerProcess;
  private readonly heartbeatIntervalMs: number;

  constructor(options?: {
    store?: WorkspaceRuntimeStore;
    workerId?: string;
    supervisor?: WorkspaceRuntimeSupervisorClient;
    listenerResolver?: typeof resolveRuntimeListenerProcess;
    heartbeatIntervalMs?: number;
  }) {
    this.store = options?.store ?? createInMemoryWorkspaceRuntimeStore();
    this.workerId = options?.workerId ?? `runtime-worker:${randomUUID()}`;
    this.supervisor = options?.supervisor;
    this.listenerResolver = options?.listenerResolver ?? resolveRuntimeListenerProcess;
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  }

  async get(projectId: string): Promise<WorkspaceRuntimeSnapshot> {
    const session = this.sessions.get(projectId);
    if (session) return this.snapshot(session);
    const persisted = await this.store.get(projectId);
    return persisted ? rowSnapshot(persisted) : this.stoppedSnapshot(projectId);
  }

  /**
   * Capture an independent after-state for a server-owned runtime action.
   * TCP readiness and a running row are not sufficient: the current worker
   * lease, process identity, HTTP response, serving revision, and optional
   * marker must all be checked at observation time.
   */
  async observeAfterState(input: {
    projectId: string;
    sessionId: string;
    revision: string;
    attestationBinding?: ChildProcessAttestationBinding;
    healthPath?: string;
    expectedMarker?: string;
    signal?: AbortSignal;
  }): Promise<RuntimeAfterState> {
    const healthPath = input.healthPath ?? "/";
    if (!healthPath.startsWith("/") || healthPath.startsWith("//")) {
      throw new WorkspaceRuntimeError(
        "Runtime health checks require a project-relative HTTP path.",
        "RUNTIME_OBSERVATION_STALE",
        400,
      );
    }
    const session = this.sessions.get(input.projectId);
    const persisted = await this.store.get(input.projectId);
    if (
      !session
      || !persisted
      || session.sessionId !== input.sessionId
      || persisted.sessionId !== input.sessionId
      || session.revision !== input.revision
      || persisted.revision !== input.revision
      || session.workerId !== this.workerId
      || persisted.workerId !== this.workerId
      || !persisted.leaseUntil
      || persisted.leaseUntil <= new Date()
      || session.status !== "running"
      || persisted.status !== "running"
    ) {
      throw new WorkspaceRuntimeError(
        "Runtime after-state requires the current running session and worker lease.",
        "RUNTIME_OBSERVATION_STALE",
        409,
      );
    }
    if (!session.port) {
      throw new WorkspaceRuntimeError(
        "Runtime after-state has no server-owned port.",
        "RUNTIME_OBSERVATION_STALE",
        409,
      );
    }

    const observedAt = new Date().toISOString();
    const processAlive = await isPidAlive(session.pid);
    const portReady = await isPortListening(session.port);
    const listenerBinding = input.attestationBinding
      ? { ...input.attestationBinding, processRole: "runtime_listener" as const }
      : undefined;
    if (input.signal?.aborted) {
      return {
        status: "unavailable",
        projectId: input.projectId,
        sessionId: input.sessionId,
        revision: input.revision,
        pid: session.pid,
        port: session.port,
        processAlive,
        portReady,
        healthPath,
        healthStatus: null,
        servingRevision: null,
        markerMatched: null,
        responseBody: "",
        childProcessAttestation: unknownChildProcessAttestation(
          "process_unavailable",
          input.attestationBinding,
          observedAt,
        ),
        listener: unknownRuntimeListenerObservation(
          "observation_cancelled",
          input.attestationBinding,
          "process_unavailable",
          observedAt,
        ),
        observedAt,
        detail: "Runtime after-state observation was cancelled.",
      };
    }

    let childProcessAttestation: ChildProcessEnvironmentAttestation;
    if (!input.attestationBinding) {
      childProcessAttestation = unknownChildProcessAttestation("binding_missing", undefined, observedAt);
    } else if (!session.childProcessBinding || !session.childProcessMarker) {
      childProcessAttestation = unknownChildProcessAttestation(
        "marker_unavailable",
        input.attestationBinding,
        observedAt,
      );
    } else if (!sameAttestationBinding(session.childProcessBinding, input.attestationBinding)) {
      childProcessAttestation = unknownChildProcessAttestation(
        "binding_mismatch",
        input.attestationBinding,
        observedAt,
      );
    } else {
      childProcessAttestation = await attestChildProcessEnvironment({
        pid: session.pid,
        projectRoot: session.projectRoot,
        marker: session.childProcessMarker,
        binding: input.attestationBinding,
        expectedEnvironment: {
          NODE_ENV: "development",
          PORT: String(session.port),
          BASE_PATH: "/",
        },
        observedAt,
      });
    }

    let listenerConfirmationTarget: {
      pid: number;
      port: number;
      identityDigest: string;
      bindingDigest: string;
    } | null = null;
    let listener: RuntimeListenerObservation;
    if (!input.attestationBinding) {
      listener = unknownRuntimeListenerObservation(
        "binding_missing",
        undefined,
        "binding_missing",
        observedAt,
      );
    } else if (!session.childProcessBinding || !session.childProcessMarker) {
      listener = unknownRuntimeListenerObservation(
        "marker_unavailable",
        input.attestationBinding,
        "marker_unavailable",
        observedAt,
      );
    } else if (!sameAttestationBinding(session.childProcessBinding, input.attestationBinding)) {
      listener = unknownRuntimeListenerObservation(
        "binding_mismatch",
        input.attestationBinding,
        "binding_mismatch",
        observedAt,
      );
    } else if (!listenerBinding) {
      listener = unknownRuntimeListenerObservation(
        "binding_missing",
        input.attestationBinding,
        "binding_missing",
        observedAt,
      );
    } else {
      const first = await resolveRuntimeListenerProcess({
        launchPid: session.pid,
        port: session.port,
        bindingDigest: childProcessBindingDigest(listenerBinding),
        observedAt,
      });
      if (
        first.status !== "known"
        || first.pid === null
        || first.port !== session.port
        || !first.identityDigest
      ) {
        const processReason = first.reasonCode === "process_unavailable"
          ? "process_unavailable"
          : first.reasonCode === "process_changed"
            ? "process_changed"
            : first.reasonCode === "unsupported_platform"
              ? "unsupported_platform"
              : "procfs_unavailable";
        listener = unknownRuntimeListenerObservation(
          first.reasonCode,
          input.attestationBinding,
          processReason,
          observedAt,
        );
      } else {
        const processAttestation = await attestChildProcessEnvironment({
          pid: first.pid,
          projectRoot: session.projectRoot,
          marker: session.childProcessMarker,
          binding: listenerBinding,
          expectedEnvironment: {
            NODE_ENV: "development",
            PORT: String(session.port),
            BASE_PATH: "/",
          },
          observedAt,
        });
        listenerConfirmationTarget = {
          pid: first.pid,
          port: first.port,
          identityDigest: first.identityDigest,
          bindingDigest: childProcessBindingDigest(listenerBinding),
        };
        listener = {
          status: processAttestation.status,
          reasonCode: processAttestation.status === "known"
            ? "listener_process_attested"
            : processAttestation.reasonCode,
          port: first.port,
          identityDigest: first.identityDigest,
          processAttestation,
        };
      }
    }

    let healthStatus: number | null = null;
    let servingRevision: string | null = null;
    let markerMatched: boolean | null = input.expectedMarker ? false : null;
    let responseBody = "";
    let detail = "Runtime is not serving the expected state.";
    try {
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(`http://127.0.0.1:${session.port}${healthPath}`, {
          redirect: "manual",
          signal: controller.signal,
        });
        healthStatus = response.status;
        responseBody = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 2_000);
        servingRevision = response.headers.get("x-engineeringos-revision");
        markerMatched = input.expectedMarker
          ? responseBody.includes(input.expectedMarker)
            || response.headers.get("x-engineeringos-marker") === input.expectedMarker
          : null;
        if (listenerConfirmationTarget) {
          const confirmation = await resolveRuntimeListenerProcess({
            launchPid: session.pid,
            port: session.port,
            bindingDigest: listenerConfirmationTarget.bindingDigest,
            observedAt,
          });
          if (
            confirmation.status !== "known"
            || confirmation.pid !== listenerConfirmationTarget.pid
            || confirmation.port !== listenerConfirmationTarget.port
            || confirmation.identityDigest !== listenerConfirmationTarget.identityDigest
          ) {
            listener = unknownRuntimeListenerObservation(
              confirmation.status === "known" ? "process_changed" : confirmation.reasonCode,
              input.attestationBinding,
              confirmation.reasonCode === "process_changed"
                ? "process_changed"
                : confirmation.reasonCode === "unsupported_platform"
                  ? "unsupported_platform"
                  : "procfs_unavailable",
              observedAt,
            );
          }
        }
        const healthPassed = response.status >= 200 && response.status < 300;
        const revisionPassed = servingRevision === input.revision;
        const markerPassed = markerMatched !== false;
        if (
          processAlive
          && portReady
          && healthPassed
          && revisionPassed
          && markerPassed
          && listener.status === "known"
          && listener.port === session.port
        ) {
          detail = "Runtime listener ownership, process environment, health, serving revision, and marker were observed.";
          return {
            status: "passed",
            projectId: input.projectId,
            sessionId: input.sessionId,
            revision: input.revision,
            pid: session.pid,
            port: session.port,
            processAlive,
            portReady,
            healthPath,
            healthStatus,
            servingRevision,
            markerMatched,
            responseBody,
            childProcessAttestation,
            listener,
            observedAt,
            detail,
          };
        }
        detail = !healthPassed
          ? `Runtime health returned HTTP ${response.status}.`
          : !revisionPassed
            ? "Runtime served a different revision."
            : !markerPassed
              ? "Runtime did not serve the expected marker."
              : listener.status !== "known"
                ? `Runtime listener was not independently attested (${listener.reasonCode}).`
              : "Runtime process or port readiness was not observed.";
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", abort);
      }
    } catch {
      detail = "Runtime health response was unavailable.";
    }
    return {
      status: processAlive && portReady ? "failed" : "unavailable",
      projectId: input.projectId,
      sessionId: input.sessionId,
      revision: input.revision,
      pid: session.pid,
      port: session.port,
      processAlive,
      portReady,
      healthPath,
      healthStatus,
      servingRevision,
      markerMatched,
      responseBody,
      childProcessAttestation,
      listener,
      observedAt,
      detail,
    };
  }

  async observeStoppedAfterState(input: {
    projectId: string;
    sessionId: string;
    revision: string;
    pid: number;
    port: number;
  }): Promise<RuntimeAfterState> {
    if (!Number.isInteger(input.pid) || input.pid <= 0 || !Number.isInteger(input.port) || input.port <= 0) {
      throw new WorkspaceRuntimeError(
        "Runtime stop after-state requires the exact pre-stop PID and port.",
        "RUNTIME_OBSERVATION_STALE",
        409,
      );
    }
    const persisted = await this.store.get(input.projectId);
    const session = this.sessions.get(input.projectId);
    const row = persisted ?? session;
    if (
      !row
      || row.sessionId !== input.sessionId
      || row.revision !== input.revision
      || row.status !== "stopped"
      || row.pid !== null
      || !row.stoppedAt
      || row.leaseUntil !== null
      || row.workerId !== null
    ) {
      throw new WorkspaceRuntimeError(
        "Runtime stop after-state requires the exact stopped session with released ownership.",
        "RUNTIME_OBSERVATION_STALE",
        409,
      );
    }
    const processAlive = await isPidAlive(input.pid);
    const portReady = await isPortListening(input.port);
    return {
      status: !processAlive && !portReady ? "passed" : "unavailable",
      projectId: input.projectId,
      sessionId: input.sessionId,
      revision: input.revision,
      pid: input.pid,
      port: input.port,
      processAlive,
      portReady,
      healthPath: "/",
      healthStatus: null,
      servingRevision: null,
      markerMatched: null,
      responseBody: "",
      listener: unknownRuntimeListenerObservation(
        "listener_not_running",
        undefined,
        "process_unavailable",
      ),
      observedAt: new Date().toISOString(),
      detail: !processAlive && !portReady
        ? "Runtime process and port closure were observed."
        : "Runtime process or port remained available after stop.",
    };
  }

  async observeRunningBeforeStop(input: {
    projectId: string;
    sessionId: string;
    revision: string;
    pid: number;
    port: number;
  }): Promise<RuntimeAfterState> {
    const persisted = await this.store.get(input.projectId);
    const session = this.sessions.get(input.projectId);
    const now = Date.now();
    if (
      !persisted
      || !session
      || persisted.sessionId !== input.sessionId
      || session.sessionId !== input.sessionId
      || persisted.revision !== input.revision
      || session.revision !== input.revision
      || persisted.status !== "running"
      || session.status !== "running"
      || persisted.pid !== input.pid
      || session.pid !== input.pid
      || persisted.port !== input.port
      || session.port !== input.port
      || persisted.workerId !== this.workerId
      || session.workerId !== this.workerId
      || !persisted.leaseUntil
      || persisted.leaseUntil.getTime() <= now
      || !session.leaseUntil
      || Date.parse(session.leaseUntil) <= now
    ) {
      throw new WorkspaceRuntimeError(
        "Runtime stop pre-state requires the exact running session and current worker lease.",
        "RUNTIME_OBSERVATION_STALE",
        409,
      );
    }
    const processAlive = await isPidAlive(input.pid);
    const portReady = await isPortListening(input.port);
    if (!processAlive || !portReady) {
      return {
        status: "unavailable",
        projectId: input.projectId,
        sessionId: input.sessionId,
        revision: input.revision,
        pid: input.pid,
        port: input.port,
        processAlive,
        portReady,
        healthPath: "/",
        healthStatus: null,
        servingRevision: null,
        markerMatched: null,
        responseBody: "",
        childProcessAttestation: unknownChildProcessAttestation(
          "process_unavailable",
          session.childProcessBinding,
        ),
        listener: unknownRuntimeListenerObservation(
          "listener_not_running",
          session.childProcessBinding,
          "process_unavailable",
        ),
        observedAt: new Date().toISOString(),
        detail: "Runtime process or port was unavailable before stop.",
      };
    }
    return this.observeAfterState({
      projectId: input.projectId,
      sessionId: input.sessionId,
      revision: input.revision,
      ...(session.childProcessBinding ? { attestationBinding: session.childProcessBinding } : {}),
    });
  }

  private listenerBindingDigest(session: RuntimeSession): string {
    if (session.childProcessBinding) {
      return childProcessBindingDigest({
        ...session.childProcessBinding,
        processRole: "runtime_listener",
      });
    }
    return createHash("sha256").update(JSON.stringify({
      schema: "runtime-listener-session-v1",
      projectId: session.projectId,
      sessionId: session.sessionId,
      revision: session.revision,
      pid: session.pid,
      port: session.port,
    })).digest("hex");
  }

  private async hasKnownListener(session: RuntimeSession): Promise<boolean> {
    if (!Number.isInteger(session.pid) || !session.port || !session.revision) return false;
    try {
      const resolution = await this.listenerResolver({
        launchPid: session.pid,
        port: session.port,
        bindingDigest: this.listenerBindingDigest(session),
      });
      return resolution.status === "known"
        && resolution.port === session.port
        && Number.isInteger(resolution.pid)
        && (resolution.pid ?? 0) > 0
        && typeof resolution.identityDigest === "string"
        && /^[a-f0-9]{64}$/.test(resolution.identityDigest);
    } catch {
      return false;
    }
  }

  private async releaseRecoveryClaim(projectId: string, sessionId: string): Promise<void> {
    await this.store.updateOwnedSession(projectId, sessionId, this.workerId, {
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    });
  }

  private async relinquishSessionForRetry(session: RuntimeSession): Promise<void> {
    this.stopHeartbeat(session);
    await this.store.updateOwnedSession(session.projectId, session.sessionId, this.workerId, {
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    });
    if (this.sessions.get(session.projectId) === session) {
      this.sessions.delete(session.projectId);
    }
  }

  async recover(projectId?: string): Promise<void> {
    const rows = await this.store.listRecoverable(new Date());
    for (const row of rows) {
      if (projectId && row.projectId !== projectId) continue;
      const claimed = await this.store.claimRecovery({
        id: row.id,
        sessionId: row.sessionId,
        workerId: this.workerId,
        now: new Date(),
        leaseUntil: new Date(Date.now() + RUNTIME_LEASE_MS),
      });
      if (!claimed) continue;
      let processAlive = await isPidAlive(claimed.pid);
      let portReady = processAlive && await waitForExistingPort(claimed.port, 5_000);
      let adoptedLogs: string[] | undefined;
      if (!processAlive || !portReady) {
        const failed = await this.store.updateOwnedSession(claimed.projectId, claimed.sessionId, this.workerId, {
          status: "failed",
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
          stoppedAt: new Date(),
          error: "Runtime process was not reachable during recovery.",
        });
        if (failed && processAlive) await terminateProcessGroup(claimed.pid, undefined);
        continue;
      }

      const candidate = sessionFromRow(claimed, this.workerId);
      if (!await this.hasKnownListener(candidate)) {
        await this.releaseRecoveryClaim(claimed.projectId, claimed.sessionId);
        continue;
      }

      if (this.supervisor && processAlive && portReady) {
        try {
          const adopted = await this.supervisor.adopt({
            projectId: claimed.projectId,
            sessionId: claimed.sessionId,
            projectRoot: claimed.projectRoot,
            pid: claimed.pid,
            port: claimed.port,
          });
          if (
            adopted.projectId !== claimed.projectId
            || adopted.sessionId !== claimed.sessionId
            || adopted.status !== "running"
            || adopted.pid !== claimed.pid
            || adopted.port !== claimed.port
          ) {
            await this.releaseRecoveryClaim(claimed.projectId, claimed.sessionId);
            continue;
          }
          adoptedLogs = adopted.logs;
        } catch {
          await this.releaseRecoveryClaim(claimed.projectId, claimed.sessionId);
          continue;
        }
      }

      if (!await this.hasKnownListener(candidate)) {
        await this.releaseRecoveryClaim(claimed.projectId, claimed.sessionId);
        continue;
      }

      const adoptedRow = claimed.status === "starting"
        ? { ...claimed, status: "running" as const }
        : claimed;
      if (
        claimed.status === "starting"
        && !await this.store.updateOwnedSession(claimed.projectId, claimed.sessionId, this.workerId, {
          status: "running",
        })
      ) {
        continue;
      }
      const existing = this.sessions.get(claimed.projectId);
      if (existing?.sessionId === claimed.sessionId) {
        existing.leaseUntil = claimed.leaseUntil?.toISOString() ?? null;
        existing.lastHeartbeatAt = claimed.lastHeartbeatAt?.toISOString() ?? null;
        existing.status = adoptedRow.status;
        if (adoptedLogs) existing.logs = [...adoptedLogs];
        this.startHeartbeat(existing);
        continue;
      }
      const session = sessionFromRow(adoptedRow, this.workerId, adoptedLogs ?? claimed.logs);
      this.sessions.set(claimed.projectId, session);
      this.startHeartbeat(session);
    }
  }

  async start(input: {
    projectId: string;
    projectRoot: string;
    revision: string;
    attestationIdentity?: ChildProcessAttestationIdentity;
    restart?: boolean;
  }): Promise<WorkspaceRuntimeSnapshot> {
    if (input.attestationIdentity && (
      input.attestationIdentity.projectId !== input.projectId
      || input.attestationIdentity.revision !== input.revision
      || !input.attestationIdentity.operationId
      || !input.attestationIdentity.executionId
      || !input.attestationIdentity.episodeId
      || !Number.isInteger(input.attestationIdentity.executionAttempt)
      || input.attestationIdentity.executionAttempt < 0
    )) {
      throw new WorkspaceRuntimeError(
        "Runtime child attestation identity does not match the server-owned operation.",
        "RUNTIME_OBSERVATION_STALE",
        409,
      );
    }
    const localSession = this.sessions.get(input.projectId);
    const persistedCurrent = localSession ? undefined : await this.store.get(input.projectId);
    const current = localSession ?? persistedCurrent;
    if (current && !input.restart && (current.status === "starting" || current.status === "running")) {
      if (localSession) return this.snapshot(localSession);
      if (persistedCurrent) return rowSnapshot(persistedCurrent);
    }
    if (current && (current.status === "starting" || current.status === "running")) {
      const stopped = await this.stop(input.projectId);
      if (stopped.status !== "stopped") {
        throw new WorkspaceRuntimeError(
          "The existing runtime session could not be safely stopped before restart.",
          "RUNTIME_OWNERSHIP_BUSY",
          409,
        );
      }
    } else if (localSession) {
      await this.stop(input.projectId);
    }

    const projectRoot = await this.validateProjectRoot(input.projectRoot);
    const directPort = this.supervisor ? null : await findAvailablePort();
    const now = new Date();
    const sessionId = randomUUID();
    const childProcessBinding = input.attestationIdentity
      ? { ...input.attestationIdentity, sessionId }
      : undefined;
    const childProcessMarker = childProcessBinding ? randomUUID() : undefined;
    const persisted = await this.store.begin({
      projectId: input.projectId,
      projectRoot,
      sessionId,
      revision: input.revision,
      environmentRevision: null,
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

    let environmentRevision: string | null = null;
    try {
      const attestation = await captureEnvironmentAttestation({
        rootPath: projectRoot,
        profile: serverEnvironmentProfile("RUNTIME_START", {
          kind: "recipe",
          recipeId: "runtime.start",
        }),
      });
      if (attestation.status === "known") {
        environmentRevision = attestation.environmentRevision;
      }
      if (environmentRevision) {
        const saved = await this.store.updateOwned(input.projectId, this.workerId, {
          environmentRevision,
        });
        if (!saved) environmentRevision = null;
      }
    } catch {
      // Environment identity is observational; capture failure must not block runtime startup.
      environmentRevision = null;
    }

    let child: ChildProcess | undefined;
    let supervised: Awaited<ReturnType<WorkspaceRuntimeSupervisorClient["start"]>> | undefined;
    try {
      if (this.supervisor) {
        supervised = await this.supervisor.start({
          projectId: input.projectId,
          sessionId,
          projectRoot,
          ...(childProcessMarker ? { attestationMarker: childProcessMarker } : {}),
        });
      } else {
        child = spawn("pnpm", ["run", "dev"], {
          cwd: projectRoot,
          env: runtimeEnv(directPort!, childProcessMarker),
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
      environmentRevision,
      startedAt: now.toISOString(),
      stoppedAt: null,
      pid,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS).toISOString(),
      lastHeartbeatAt: now.toISOString(),
      error: null,
      logs: supervised?.logs ?? [],
      child,
      ...(childProcessMarker ? { childProcessMarker } : {}),
      ...(childProcessBinding ? { childProcessBinding } : {}),
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
      await this.recover(projectId);
      session = this.sessions.get(projectId);
      if (!session) {
        const current = await this.store.get(projectId);
        return current ? rowSnapshot(current) : this.stoppedSnapshot(projectId);
      }
    }
    const activeSession = session;
    const persisted = await this.store.get(projectId);
    if (
      (activeSession.status === "starting" || activeSession.status === "running")
      && (
        !persisted
        || persisted.sessionId !== activeSession.sessionId
        || persisted.workerId !== this.workerId
        || !persisted.leaseUntil
        || persisted.leaseUntil.getTime() <= Date.now()
      )
    ) {
      this.stopHeartbeat(activeSession);
      if (this.sessions.get(projectId) === activeSession) this.sessions.delete(projectId);
      return persisted ? rowSnapshot(persisted) : this.stoppedSnapshot(projectId);
    }
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
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(session: RuntimeSession): void {
    if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = undefined;
  }

  private async heartbeat(session: RuntimeSession): Promise<void> {
    if (session.heartbeatInFlight || this.sessions.get(session.projectId) !== session) return;
    session.heartbeatInFlight = true;
    try {
      const renewLease = async (): Promise<boolean> => {
        const expectedStatus = session.status;
        if (expectedStatus !== "starting" && expectedStatus !== "running") return false;
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + RUNTIME_LEASE_MS);
        const owned = await this.store.updateOwnedSession(
          session.projectId,
          session.sessionId,
          this.workerId,
          { leaseUntil, lastHeartbeatAt: now },
          expectedStatus,
        );
        if (!owned) {
          this.stopHeartbeat(session);
          if (this.sessions.get(session.projectId) === session) {
            this.sessions.delete(session.projectId);
          }
          return false;
        }
        if (this.sessions.get(session.projectId) === session) {
          session.leaseUntil = leaseUntil.toISOString();
          session.lastHeartbeatAt = now.toISOString();
        }
        return true;
      };

      // Startup can legitimately take up to STARTUP_TIMEOUT_MS. Its current
      // worker may extend the lease, but no running/healthy state is implied.
      if (session.status === "starting") {
        await renewLease();
        return;
      }
      if (session.status !== "running") {
        this.stopHeartbeat(session);
        return;
      }
      if (!await this.hasKnownListener(session)) {
        await this.relinquishSessionForRetry(session);
        return;
      }
      if (this.supervisor) {
        try {
          const adopted = await this.supervisor.adopt({
            projectId: session.projectId,
            sessionId: session.sessionId,
            projectRoot: session.projectRoot,
            pid: session.pid,
            port: session.port,
          });
          if (
            adopted.projectId !== session.projectId
            || adopted.sessionId !== session.sessionId
            || adopted.status !== "running"
            || adopted.pid !== session.pid
            || adopted.port !== session.port
          ) {
            await this.relinquishSessionForRetry(session);
            return;
          }
        } catch {
          await this.relinquishSessionForRetry(session);
          return;
        }
        if (!await this.hasKnownListener(session)) {
          await this.relinquishSessionForRetry(session);
          return;
        }
      }
      await renewLease();
    } finally {
      session.heartbeatInFlight = false;
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
      // Fence the exit handler before signalling the process so a normal
      // SIGTERM cannot race and reclassify an intentional stop as failed.
      session.status = finalStatus;
      if (this.supervisor) {
        await this.supervisor.stop({
          projectId: session.projectId,
          sessionId: session.sessionId,
          pid: session.pid,
        });
      } else {
        await terminateProcessGroup(session.pid, session.child);
      }
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
      environmentRevision: null,
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