import http from "node:http";
import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { createWorkspaceRuntimeSupervisorCommand } from "../../../../scripts/workspace-runtime-supervisor-protocol.mjs";

type SupervisorAction = "start" | "adopt" | "stop" | "observe-start";
type ProcessIdentity =
  | null
  | { pid: number | null }
  | { pid: number | null; port: number | null; listenerIdentityDigest: string };

type SupervisorResponse = {
  projectId: string;
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
  status: "running" | "stopped" | "unknown";
  session?: SupervisorResponse;
  observedAt: string;
  inventoryComplete: boolean;
  unknownListenerPorts: number[];
  detail: string;
};

type SupervisorControlRequest = {
  socketPath: string;
  path: string;
  body: string;
  encodedCommand: string;
  signature: string;
};

type SupervisorControlResponse = {
  status: number;
  body: string;
};

export type WorkspaceRuntimeSupervisorRequestImpl =
  (request: SupervisorControlRequest) => Promise<SupervisorControlResponse>;

export class WorkspaceRuntimeSupervisorError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "WorkspaceRuntimeSupervisorError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createWorkspaceRuntimeSupervisorStateVersion(input: {
  projectId: string;
  sessionId: string;
  revision: string;
  startedAt: string;
}): string {
  const startedAt = Date.parse(input.startedAt);
  if (
    !input.projectId
    || !input.sessionId
    || !input.revision
    || !Number.isFinite(startedAt)
  ) {
    throw new WorkspaceRuntimeSupervisorError(
      "Runtime session state is incomplete for supervisor command binding.",
      409,
    );
  }
  return sha256(JSON.stringify({
    schema: "workspace-runtime-supervisor-state-v1",
    projectId: input.projectId,
    sessionId: input.sessionId,
    revision: input.revision,
    startedAt,
  }));
}

function loadSigningKey(encoded?: string): ReturnType<typeof createPrivateKey> {
  const value = encoded ?? process.env.WORKSPACE_RUNTIME_SUPERVISOR_SIGNING_PRIVATE_KEY_B64;
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new WorkspaceRuntimeSupervisorError(
      "Workspace runtime supervisor signing key is not configured.",
      503,
    );
  }
  try {
    const der = Buffer.from(value, "base64");
    if (der.toString("base64") !== value) throw new Error("Non-canonical signing key encoding.");
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 key required.");
    return key;
  } catch {
    throw new WorkspaceRuntimeSupervisorError(
      "Workspace runtime supervisor signing key is invalid.",
      503,
    );
  }
}

function requestOverUnixSocket(input: SupervisorControlRequest): Promise<SupervisorControlResponse> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(input.body, "utf8");
    const request = http.request({
      socketPath: input.socketPath,
      path: input.path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(body.byteLength),
        "x-eos-command": input.encodedCommand,
        "x-eos-signature": input.signature,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer | string) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += value.byteLength;
        if (received > 128_000) {
          request.destroy(new Error("Supervisor response exceeded the allowed size."));
          return;
        }
        chunks.push(value);
      });
      response.once("error", reject);
      response.once("end", () => resolve({
        status: response.statusCode ?? 502,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Supervisor request timed out.")));
    request.once("error", reject);
    request.end(body);
  });
}

export class WorkspaceRuntimeSupervisorClient {
  constructor(
    private readonly socketPath = process.env.WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH ?? "",
    private readonly signingKeyBase64 = process.env.WORKSPACE_RUNTIME_SUPERVISOR_SIGNING_PRIVATE_KEY_B64,
    private readonly requestImpl: WorkspaceRuntimeSupervisorRequestImpl = requestOverUnixSocket,
    private readonly now: () => number = Date.now,
  ) {}

  async start(input: {
    projectId: string;
    sessionId: string;
    stateVersion: string;
    projectRoot: string;
    attestationMarker?: string;
    listenerBindingDigest?: string;
  }): Promise<SupervisorResponse> {
    return this.request("start", "/runtime/start", input.projectId, input.sessionId,
      input.stateVersion, null, {
        projectId: input.projectId,
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        profile: "dev",
        ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
        ...(input.listenerBindingDigest ? { listenerBindingDigest: input.listenerBindingDigest } : {}),
      });
  }

  async adopt(input: {
    projectId: string;
    sessionId: string;
    stateVersion: string;
    projectRoot: string;
    pid: number | null;
    port: number | null;
    listenerBindingDigest: string;
    expectedListenerIdentityDigest: string;
    attestationMarker?: string;
  }): Promise<SupervisorResponse> {
    const processIdentity = {
      pid: input.pid,
      port: input.port,
      listenerIdentityDigest: input.expectedListenerIdentityDigest,
    };
    return this.request("adopt", "/runtime/adopt", input.projectId, input.sessionId,
      input.stateVersion, processIdentity, {
        projectId: input.projectId,
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        pid: input.pid,
        port: input.port,
        profile: "dev",
        listenerBindingDigest: input.listenerBindingDigest,
        expectedListenerIdentityDigest: input.expectedListenerIdentityDigest,
        ...(input.attestationMarker ? { attestationMarker: input.attestationMarker } : {}),
      });
  }

  async stop(input: {
    projectId: string;
    sessionId: string;
    stateVersion: string;
    pid: number | null;
  }): Promise<void> {
    await this.request("stop", "/runtime/stop", input.projectId, input.sessionId,
      input.stateVersion, { pid: input.pid }, {
        projectId: input.projectId,
        sessionId: input.sessionId,
        pid: input.pid,
      });
  }

  async observeStartState(projectId: string): Promise<ObserveStartState> {
    const stateVersion = sha256(JSON.stringify({
      schema: "workspace-runtime-inventory-v1",
      projectId,
      nonce: randomUUID(),
      issuedAt: this.now(),
    }));
    const payload = await this.request("observe-start", "/runtime/observe-start",
      projectId, null, stateVersion, null, { projectId, sessionId: null });
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

  private async request(
    action: SupervisorAction,
    path: string,
    projectId: string,
    sessionId: string | null,
    stateVersion: string,
    processIdentity: ProcessIdentity,
    bodyValue: Record<string, unknown>,
  ): Promise<SupervisorResponse> {
    if (!this.socketPath || !this.socketPath.startsWith("/")) {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor Unix socket is not configured.",
        503,
      );
    }
    let signed;
    try {
      signed = createWorkspaceRuntimeSupervisorCommand({
        privateKey: loadSigningKey(this.signingKeyBase64),
        action,
        projectId,
        sessionId,
        stateVersion,
        processIdentity,
        body: bodyValue,
        now: this.now(),
      });
    } catch (error) {
      if (error instanceof WorkspaceRuntimeSupervisorError) throw error;
      throw new WorkspaceRuntimeSupervisorError("Supervisor command could not be signed.", 503);
    }

    let response: SupervisorControlResponse;
    try {
      response = await this.requestImpl({
        socketPath: this.socketPath,
        path,
        body: signed.body,
        encodedCommand: signed.encodedCommand,
        signature: signed.signature,
      });
    } catch {
      throw new WorkspaceRuntimeSupervisorError(
        "Workspace runtime supervisor is unavailable over its protected Unix socket.",
        503,
      );
    }
    let payload: Partial<SupervisorResponse> & { error?: string };
    try {
      payload = JSON.parse(response.body || "{}") as Partial<SupervisorResponse> & { error?: string };
    } catch {
      throw new WorkspaceRuntimeSupervisorError("Workspace runtime supervisor returned invalid JSON.");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new WorkspaceRuntimeSupervisorError(
        payload.error ?? "Workspace runtime supervisor rejected the signed command.",
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
