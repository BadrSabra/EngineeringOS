type SupervisorResponse = {
  projectId: string;
  sessionId: string;
  status: "starting" | "running" | "stopped" | "failed";
  port: number | null;
  pid: number | null;
  logs?: string[];
  error?: string | null;
};

export type ObserveStartState = {
  projectId: string;
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
  ) {}

  async start(input: {
    projectId: string;
    sessionId: string;
    projectRoot: string;
    attestationMarker?: string;
  }): Promise<SupervisorResponse> {
    return this.request("/runtime/start", {
      method: "POST",
      body: JSON.stringify({
        projectId: input.projectId,
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        profile: "dev",
        ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
      }),
    });
  }

  async adopt(input: {
    projectId: string;
    sessionId: string;
    projectRoot: string;
    pid: number | null;
    port: number | null;
  }): Promise<SupervisorResponse> {
    return this.request("/runtime/adopt", {
      method: "POST",
      body: JSON.stringify({
        projectId: input.projectId,
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        pid: input.pid,
        port: input.port,
        profile: "dev",
      }),
    });
  }

  async stop(input: {
    projectId: string;
    sessionId: string;
    pid: number | null;
  }): Promise<void> {
    await this.request("/runtime/stop", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async observeStartState(projectId: string): Promise<ObserveStartState> {
    const payload = await this.request("/runtime/observe-start", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
    if (!isObserveStartState(payload)) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor returned an invalid observation.",
      );
    }
    if (payload.projectId !== projectId) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor returned an observation for a different project.",
      );
    }
    return payload;
  }

  private async request(path: string, init: RequestInit): Promise<SupervisorResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
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
}

function isObserveStartState(value: unknown): value is ObserveStartState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ObserveStartState>;
  if (
    typeof candidate.projectId !== "string"
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
      && candidate.session.status === "running"
      && candidate.session.pid !== null
      && candidate.session.port !== null
      && candidate.unknownListenerPorts.length === 0;
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
  );
}