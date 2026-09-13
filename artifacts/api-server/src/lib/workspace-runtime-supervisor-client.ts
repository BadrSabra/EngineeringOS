type SupervisorResponse = {
  projectId: string;
  sessionId: string;
  status: "starting" | "running" | "stopped" | "failed";
  port: number | null;
  pid: number | null;
  logs?: string[];
  error?: string | null;
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
  }): Promise<SupervisorResponse> {
    return this.request("/runtime/start", {
      method: "POST",
      body: JSON.stringify({
        projectId: input.projectId,
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        profile: "dev",
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