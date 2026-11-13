import { createHmac } from "node:crypto";

const SUPERVISOR_AUTH_CONTEXT = "EngineeringOS/workspace-runtime-supervisor/v1";
const SUPERVISOR_COMMAND_CONTEXT = "EngineeringOS/workspace-runtime-supervisor/project-binding/v1";
const SUPERVISOR_COMMAND_SIGNATURE_HEADER = "x-engineeringos-command-signature";

export function signWorkspaceRuntimeSupervisorCommand(
  secret: string,
  path: string,
  body: string,
): string {
  if (!secret) throw new Error("Workspace runtime supervisor command signing is not configured.");
  return createHmac("sha256", secret)
    .update(SUPERVISOR_COMMAND_CONTEXT)
    .update("\n")
    .update(path)
    .update("\n")
    .update(body)
    .digest("hex");
}

export function deriveWorkspaceRuntimeSupervisorToken(secret: string): string {
  if (!secret) {
    throw new Error("Workspace runtime supervisor authentication is not configured.");
  }
  return createHmac("sha256", secret)
    .update(SUPERVISOR_AUTH_CONTEXT)
    .digest("hex");
}

type SupervisorResponse = {
  projectId: string;
  ownerProjectId: string;
  sessionId: string;
  status: "starting" | "running" | "stopped" | "failed";
  port: number | null;
  pid: number | null;
  listenerIdentityDigest?: string | null;
  logs?: string[];
  error?: string | null;
};

export type ObserveStartState = {
  projectId: string;
  ownerProjectId: string;
  projectRoot: string;
  status: "running" | "stopped" | "unknown";
  session?: SupervisorResponse;
  observedAt: string;
  inventoryComplete: boolean;
  unknownListenerPorts: number[];
  detail: string;
};

export class WorkspaceRuntimeSupervisorError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "WorkspaceRuntimeSupervisorError";
  }
}

export class WorkspaceRuntimeSupervisorClient {
  constructor(
    private readonly baseUrl = "http://127.0.0.1:8099",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly testAuthToken?: string,
    private readonly testCommandSecret?: string,
  ) {}

  async start(input: {
    projectId: string;
    ownerProjectId: string;
    sessionId: string;
    projectRoot: string;
    attestationMarker?: string;
    listenerBindingDigest?: string;
  }): Promise<SupervisorResponse> {
    const response = await this.request("/runtime/start", {
      method: "POST",
      body: JSON.stringify({
        projectId: input.projectId,
        ownerProjectId: input.ownerProjectId,
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        profile: "dev",
        ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
        ...(input.listenerBindingDigest
          ? { listenerBindingDigest: input.listenerBindingDigest }
          : {}),
      }),
    });
    return this.assertSessionIdentity(response, input);
  }

  async adopt(input: {
    projectId: string;
    ownerProjectId: string;
    sessionId: string;
    projectRoot: string;
    pid: number | null;
    port: number | null;
    listenerBindingDigest: string;
    expectedListenerIdentityDigest: string;
    attestationMarker?: string;
  }): Promise<SupervisorResponse> {
    const response = await this.request("/runtime/adopt", {
      method: "POST",
      body: JSON.stringify({
        projectId: input.projectId,
        ownerProjectId: input.ownerProjectId,
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        pid: input.pid,
        port: input.port,
        profile: "dev",
        listenerBindingDigest: input.listenerBindingDigest,
        expectedListenerIdentityDigest: input.expectedListenerIdentityDigest,
        ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
      }),
    });
    return this.assertSessionIdentity(response, input);
  }

  async stop(input: {
    projectId: string;
    ownerProjectId: string;
    sessionId: string;
    projectRoot: string;
    pid: number | null;
  }): Promise<void> {
    const response = await this.request("/runtime/stop", {
      method: "POST",
      body: JSON.stringify(input),
    });
    this.assertSessionIdentity(response, input);
  }

  async observeStartState(input: {
    projectId: string;
    ownerProjectId: string;
    projectRoot: string;
  }): Promise<ObserveStartState> {
    const payload = await this.request("/runtime/observe-start", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isObserveStartState(payload)) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor returned an invalid observation.",
      );
    }
    if (
      payload.projectId !== input.projectId
      || payload.ownerProjectId !== input.ownerProjectId
      || payload.projectRoot !== input.projectRoot
    ) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor returned an observation for a different project or root.",
        409,
      );
    }
    return payload;
  }

  private async request(path: string, init: RequestInit): Promise<SupervisorResponse> {
    const token = this.testAuthToken ?? this.deriveAuthToken();
    const body = typeof init.body === "string" ? init.body : "";
    const signature = signWorkspaceRuntimeSupervisorCommand(
      this.commandSigningSecret(),
      path,
      body,
    );
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          [SUPERVISOR_COMMAND_SIGNATURE_HEADER]: signature,
        },
      });
    } catch {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor is unavailable.",
        503,
      );
    }
    const payload = await response.json().catch(() => ({})) as Partial<SupervisorResponse> & { error?: string };
    if (!response.ok) {
      throw new WorkspaceRuntimeSupervisorError(
        payload.error ?? "Workspace runtime supervisor rejected the operation.",
        response.status >= 500 ? 502 : response.status,
      );
    }
    return payload as SupervisorResponse;
  }

  private assertSessionIdentity(
    value: SupervisorResponse,
    expected: { projectId: string; ownerProjectId: string; sessionId: string },
  ): SupervisorResponse {
    if (!isSupervisorResponse(value)) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor returned an invalid session response.",
      );
    }
    if (
      value.projectId !== expected.projectId
      || value.ownerProjectId !== expected.ownerProjectId
      || value.sessionId !== expected.sessionId
    ) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor returned a session for a different project or owner.",
        409,
      );
    }
    return value;
  }

  private commandSigningSecret(): string {
    const secret = this.testCommandSecret ?? process.env.SESSION_SECRET;
    if (!secret) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor command signing is not configured.",
        503,
      );
    }
    return secret;
  }

  private deriveAuthToken(): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor authentication is not configured.",
        503,
      );
    }
    return deriveWorkspaceRuntimeSupervisorToken(secret);
  }
}

function isObserveStartState(value: unknown): value is ObserveStartState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ObserveStartState>;
  if (
    typeof candidate.projectId !== "string"
    || typeof candidate.ownerProjectId !== "string"
    || typeof candidate.projectRoot !== "string"
    || !path.isAbsolute(candidate.projectRoot)
    || !["running", "stopped", "unknown"].includes(candidate.status ?? "")
    || typeof candidate.observedAt !== "string"
    || Number.isNaN(Date.parse(candidate.observedAt))
    || candidate.inventoryComplete !== true
    || !Array.isArray(candidate.unknownListenerPorts)
    || !candidate.unknownListenerPorts.every((port) => Number.isInteger(port) && port >= 3000 && port <= 3099)
    || typeof candidate.detail !== "string"
  ) return false;
  if (candidate.status === "running") {
    return isSupervisorResponse(candidate.session)
      && candidate.session.projectId === candidate.projectId
      && candidate.session.ownerProjectId === candidate.ownerProjectId
      && candidate.session.status === "running"
      && candidate.session.pid !== null
      && candidate.session.port !== null;
  }
  if (candidate.status === "stopped") {
    return candidate.session === undefined && candidate.unknownListenerPorts.length === 0;
  }
  return candidate.session === undefined;
}

function isSupervisorResponse(value: unknown): value is SupervisorResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SupervisorResponse>;
  return (
    typeof candidate.projectId === "string"
    && typeof candidate.ownerProjectId === "string"
    && typeof candidate.sessionId === "string"
    && ["starting", "running", "stopped", "failed"].includes(candidate.status ?? "")
    && (candidate.port === null || (
      typeof candidate.port === "number"
      && Number.isInteger(candidate.port)
      && candidate.port >= 3000
      && candidate.port <= 3099
    ))
    && (candidate.pid === null || (
      typeof candidate.pid === "number"
      && Number.isInteger(candidate.pid)
      && candidate.pid > 0
    ))
    && (candidate.logs === undefined || (Array.isArray(candidate.logs) && candidate.logs.every((line) => typeof line === "string")))
    && (candidate.error === undefined || candidate.error === null || typeof candidate.error === "string")
    && (candidate.listenerIdentityDigest === undefined || candidate.listenerIdentityDigest === null
      || (typeof candidate.listenerIdentityDigest === "string"
        && /^[a-f0-9]{64}$/.test(candidate.listenerIdentityDigest)))
  );
}