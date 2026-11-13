import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  previewAgentHeartbeatChallengeRequestPayload,
  previewAgentHeartbeatProofPayload,
  previewAgentPairingProofPayload,
  previewAgentPublicKeyFingerprint,
} from "@workspace/preview-agent-contract";
import {
  validatePreviewAgentIdentity,
  PreviewAgentIdentityError,
  type PreviewAgentIdentity,
} from "./identity.js";
import {
  PreviewAgentSecretStoreError,
  type PreviewAgentSecretStore,
} from "./linux-secret-service.js";
import {
  PreviewAgentLockError,
  withLinuxAgentLock,
} from "./linux-agent-lock.js";

export const PREVIEW_AGENT_VERSION = "0.1.0";
export const PREVIEW_AGENT_HEARTBEAT_INTERVAL_MS = 30_000;
export const PREVIEW_AGENT_CHALLENGE_TTL_MS = 60_000;
const API_TIMEOUT_MS = 8_000;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class PreviewAgentClientError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_SERVER_URL_INVALID"
      | "PREVIEW_AGENT_PAIRING_REQUIRED"
      | "PREVIEW_AGENT_PAIRING_ALREADY_ACTIVE"
      | "PREVIEW_AGENT_PAIRING_REJECTED"
      | "PREVIEW_AGENT_PAIRING_UNAVAILABLE"
      | "PREVIEW_AGENT_HEARTBEAT_REJECTED"
      | "PREVIEW_AGENT_HEARTBEAT_RETRY"
      | "PREVIEW_AGENT_SEQUENCE_EXHAUSTED"
      | "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    readonly retryAfterMs?: number,
  ) {
    super("Preview Agent operation failed.");
    this.name = "PreviewAgentClientError";
  }
}

export type PreviewAgentFetch = typeof fetch;

export type PairPreviewAgentInput = {
  apiUrl: string;
  nodeId: string;
  storeId: string;
  pairingCode: string;
  pairingExpiresAt: string;
  secretStore: PreviewAgentSecretStore;
  fetchImpl?: PreviewAgentFetch;
  now?: Date;
};

export async function pairPreviewAgent(
  input: PairPreviewAgentInput,
): Promise<{ nodeId: string; fingerprint: string; keyVersion: number }> {
  const apiOrigin = normalizeApiOrigin(input.apiUrl);
  const now = input.now ?? new Date();
  if (
    !isUuid(input.nodeId) ||
    !isUuid(input.storeId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.pairingCode) ||
    !isIsoDate(input.pairingExpiresAt) ||
    Date.parse(input.pairingExpiresAt) <= now.getTime()
  ) {
    throw new PreviewAgentClientError("PREVIEW_AGENT_PAIRING_REJECTED");
  }

  let identity = await input.secretStore.get(input.nodeId);
  if (identity?.state === "active") {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_PAIRING_ALREADY_ACTIVE",
    );
  }
  if (identity && (
    identity.storeId !== input.storeId ||
    identity.pairing?.code !== input.pairingCode ||
    identity.pairing.expiresAt !== input.pairingExpiresAt
  )) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_PAIRING_ALREADY_ACTIVE",
    );
  }

  if (!identity) {
    const keyPair = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const fingerprint = previewAgentPublicKeyFingerprint(
      keyPair.publicKey,
    );
    identity = validatePreviewAgentIdentity({
      version: 1,
      state: "pairing",
      nodeId: input.nodeId,
      storeId: input.storeId,
      keyVersion: 0,
      publicKeyPem: keyPair.publicKey,
      privateKeyPem: keyPair.privateKey,
      fingerprint,
      sequence: 0,
      pairing: {
        code: input.pairingCode,
        expiresAt: input.pairingExpiresAt,
      },
    });
    // Persist the key and one-time pairing proof material before network I/O.
    // If the response is lost, the same key and proof can safely be retried.
    await input.secretStore.set(identity);
  }

  const pairing = identity.pairing;
  if (!pairing) {
    throw new PreviewAgentClientError("PREVIEW_AGENT_PAIRING_REJECTED");
  }
  const payload = previewAgentPairingProofPayload({
    pairingCode: pairing.code,
    nodeId: identity.nodeId,
    storeId: identity.storeId,
    expiresAt: new Date(pairing.expiresAt),
  });
  const proof = sign(null, payload, identity.privateKeyPem).toString("base64url");

  let response: Record<string, unknown>;
  try {
    response = await postJson(
      apiOrigin,
      "/api/preview-agent-pairings/complete",
      {
        pairingCode: pairing.code,
        storeId: identity.storeId,
        publicKeyPem: identity.publicKeyPem,
        proof,
        agentVersion: PREVIEW_AGENT_VERSION,
        platform: "linux",
      },
      input.fetchImpl,
    );
  } catch (error) {
    if (
      error instanceof PreviewAgentClientError &&
      error.code === "PREVIEW_AGENT_PAIRING_REJECTED"
    ) {
      await input.secretStore.delete(identity.nodeId);
    }
    throw error;
  }

  if (
    response.nodeId !== identity.nodeId ||
    response.storeId !== identity.storeId ||
    response.status !== "active" ||
    response.keyVersion !== 1 ||
    response.fingerprint !== identity.fingerprint
  ) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  const active = validatePreviewAgentIdentity({
    ...identity,
    state: "active",
    keyVersion: 1,
    pairing: undefined,
  });
  await input.secretStore.set(active);
  return {
    nodeId: active.nodeId,
    fingerprint: active.fingerprint,
    keyVersion: active.keyVersion,
  };
}

export type HeartbeatInput = {
  apiUrl: string;
  nodeId: string;
  secretStore: PreviewAgentSecretStore;
  fetchImpl?: PreviewAgentFetch;
  now?: Date;
};

export async function sendPreviewAgentHeartbeat(
  input: HeartbeatInput,
): Promise<{ nodeId: string; sequence: number; lastSeenAt: string }> {
  const apiOrigin = normalizeApiOrigin(input.apiUrl);
  let identity = await input.secretStore.get(input.nodeId);
  if (!identity || identity.state !== "active") {
    throw new PreviewAgentClientError("PREVIEW_AGENT_PAIRING_REQUIRED");
  }
  identity = validatePreviewAgentIdentity(identity);

  if (identity.pendingHeartbeat) {
    try {
      const result = await submitHeartbeatProof({
        apiOrigin,
        identity,
        pending: identity.pendingHeartbeat,
        fetchImpl: input.fetchImpl,
      });
      const accepted = validatePreviewAgentIdentity({
        ...identity,
        pendingHeartbeat: undefined,
        lastChallengeRequestedAt: undefined,
        lastSeenAt: result.lastSeenAt,
      });
      await input.secretStore.set(accepted);
      return result;
    } catch (error) {
      if (
        error instanceof PreviewAgentClientError &&
        (error.code === "PREVIEW_AGENT_HEARTBEAT_REJECTED" ||
          error.code === "PREVIEW_AGENT_HEARTBEAT_RETRY")
      ) {
        await input.secretStore.set(
          validatePreviewAgentIdentity({
            ...identity,
            pendingHeartbeat: undefined,
          }),
        );
      }
      throw error;
    }
  }

  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  const lastRequestAt = identity.lastChallengeRequestedAt
    ? Date.parse(identity.lastChallengeRequestedAt)
    : Number.NEGATIVE_INFINITY;
  const retryAfterMs = Math.max(
    0,
    lastRequestAt + PREVIEW_AGENT_CHALLENGE_TTL_MS + 1_000 - now.getTime(),
  );
  if (retryAfterMs > 0) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_HEARTBEAT_RETRY",
      retryAfterMs,
    );
  }
  if (identity.sequence >= 2_147_483_647) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_SEQUENCE_EXHAUSTED",
    );
  }

  const sequence = identity.sequence + 1;
  const requestAt = now.toISOString();
  identity = validatePreviewAgentIdentity({
    ...identity,
    sequence,
    lastChallengeRequestedAt: requestAt,
  });
  // Advance the durable counter before sending the signed challenge request.
  // A crash may skip a number, but can never make the client reuse one.
  await input.secretStore.set(identity);

  const challengeRequest = {
    version: 1 as const,
    action: "request-preview-agent-heartbeat-challenge" as const,
    nodeId: identity.nodeId,
    keyVersion: identity.keyVersion,
    sequence,
    nonce: randomUUID(),
  };
  const requestSignature = sign(
    null,
    previewAgentHeartbeatChallengeRequestPayload(challengeRequest),
    identity.privateKeyPem,
  ).toString("base64url");
  let challengeResponse: Record<string, unknown>;
  try {
    challengeResponse = await postJson(
      apiOrigin,
      `/api/internal/preview-agents/${identity.nodeId}/heartbeat-challenge`,
      { proof: challengeRequest, signature: requestSignature },
      input.fetchImpl,
    );
  } catch (error) {
    if (
      error instanceof PreviewAgentClientError &&
      error.code === "PREVIEW_AGENT_HEARTBEAT_RETRY"
    ) {
      const nextRetry = Math.max(
        0,
        Date.parse(requestAt) + PREVIEW_AGENT_CHALLENGE_TTL_MS + 1_000 -
          now.getTime(),
      );
      throw new PreviewAgentClientError(
        "PREVIEW_AGENT_HEARTBEAT_RETRY",
        nextRetry,
      );
    }
    throw error;
  }
  if (
    challengeResponse.nodeId !== identity.nodeId ||
    challengeResponse.keyVersion !== identity.keyVersion ||
    typeof challengeResponse.challenge !== "string" ||
    !TOKEN_PATTERN.test(challengeResponse.challenge) ||
    typeof challengeResponse.expiresAt !== "string" ||
    !isIsoDate(challengeResponse.expiresAt)
  ) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  const expiresAt = Date.parse(challengeResponse.expiresAt);
  if (
    expiresAt <= now.getTime() ||
    expiresAt > now.getTime() + PREVIEW_AGENT_CHALLENGE_TTL_MS + 5_000
  ) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }

  const proof = {
    version: 1 as const,
    action: "preview-agent-heartbeat" as const,
    nodeId: identity.nodeId,
    keyVersion: identity.keyVersion,
    sequence,
    challenge: challengeResponse.challenge,
  };
  const signature = sign(
    null,
    previewAgentHeartbeatProofPayload(proof),
    identity.privateKeyPem,
  ).toString("base64url");
  if (!SIGNATURE_PATTERN.test(signature)) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  const pendingHeartbeat = {
    sequence,
    challenge: proof.challenge,
    signature,
    expiresAt: challengeResponse.expiresAt,
  };
  identity = validatePreviewAgentIdentity({
    ...identity,
    pendingHeartbeat,
  });
  // Keep the exact signed proof in the OS keyring before sending. If the reply
  // is lost, the server's idempotent acceptance can be recovered by retrying it.
  await input.secretStore.set(identity);

  const result = await submitHeartbeatProof({
    apiOrigin,
    identity,
    pending: pendingHeartbeat,
    fetchImpl: input.fetchImpl,
  });
  const accepted = validatePreviewAgentIdentity({
    ...identity,
    pendingHeartbeat: undefined,
    lastChallengeRequestedAt: undefined,
    lastSeenAt: result.lastSeenAt,
  });
  await input.secretStore.set(accepted);
  return result;
}

export async function runPreviewAgentHeartbeatLoop(input: {
  apiUrl: string;
  nodeId: string;
  secretStore: PreviewAgentSecretStore;
  fetchImpl?: PreviewAgentFetch;
  signal: AbortSignal;
  onHeartbeat?: (lastSeenAt: string) => void;
}): Promise<void> {
  await withLinuxAgentLock(input.nodeId, async () => {
    while (!input.signal.aborted) {
      try {
        const result = await sendPreviewAgentHeartbeat(input);
        input.onHeartbeat?.(result.lastSeenAt);
        await waitForAbortableDelay(
          PREVIEW_AGENT_HEARTBEAT_INTERVAL_MS,
          input.signal,
        );
      } catch (error) {
        if (input.signal.aborted) return;
        if (
          error instanceof PreviewAgentSecretStoreError ||
          error instanceof PreviewAgentIdentityError ||
          error instanceof PreviewAgentLockError
        ) {
          throw error;
        }
        if (
          error instanceof PreviewAgentClientError &&
          [
            "PREVIEW_AGENT_PAIRING_REQUIRED",
            "PREVIEW_AGENT_SERVER_URL_INVALID",
            "PREVIEW_AGENT_PAIRING_REJECTED",
            "PREVIEW_AGENT_SEQUENCE_EXHAUSTED",
            "PREVIEW_AGENT_HEARTBEAT_REJECTED",
            "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
          ].includes(error.code)
        ) {
          throw error;
        }
        const delay =
          error instanceof PreviewAgentClientError
            ? error.retryAfterMs ?? 5_000
            : 5_000;
        await waitForAbortableDelay(delay, input.signal);
      }
    }
  });
}

async function submitHeartbeatProof(input: {
  apiOrigin: string;
  identity: PreviewAgentIdentity;
  pending: {
    sequence: number;
    challenge: string;
    signature: string;
  };
  fetchImpl?: PreviewAgentFetch;
}): Promise<{ nodeId: string; sequence: number; lastSeenAt: string }> {
  const proof = {
    version: 1 as const,
    action: "preview-agent-heartbeat" as const,
    nodeId: input.identity.nodeId,
    keyVersion: input.identity.keyVersion,
    sequence: input.pending.sequence,
    challenge: input.pending.challenge,
  };
  const response = await postJson(
    input.apiOrigin,
    `/api/internal/preview-agents/${input.identity.nodeId}/heartbeat`,
    { proof, signature: input.pending.signature },
    input.fetchImpl,
  );
  if (
    response.nodeId !== input.identity.nodeId ||
    response.sequence !== input.pending.sequence ||
    typeof response.lastSeenAt !== "string" ||
    !isIsoDate(response.lastSeenAt)
  ) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  return {
    nodeId: input.identity.nodeId,
    sequence: input.pending.sequence,
    lastSeenAt: response.lastSeenAt,
  };
}

function normalizeApiOrigin(value: string): string {
  try {
    const url = new URL(value);
    const localHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (
      (url.protocol !== "https:" && !(localHost && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("invalid origin");
    }
    return url.origin;
  } catch {
    throw new PreviewAgentClientError("PREVIEW_AGENT_SERVER_URL_INVALID");
  }
}

async function postJson(
  origin: string,
  path: string,
  body: unknown,
  fetchImpl: PreviewAgentFetch = fetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(path, origin), {
      method: "POST",
      headers: {
        accept: "application/json",
        "cache-control": "no-store",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    );
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  if (text.length > 8_192) {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid response object");
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    );
  }
  if (!response.ok) {
    const serverCode =
      typeof payload.error === "string" ? payload.error : undefined;
    if (serverCode === "preview_agent_heartbeat_challenge_pending") {
      throw new PreviewAgentClientError(
        "PREVIEW_AGENT_HEARTBEAT_RETRY",
        PREVIEW_AGENT_CHALLENGE_TTL_MS + 1_000,
      );
    }
    if (
      serverCode === "preview_agent_heartbeat_rejected"
    ) {
      throw new PreviewAgentClientError(
        "PREVIEW_AGENT_HEARTBEAT_REJECTED",
      );
    }
    if (serverCode === "preview_agent_heartbeat_replayed") {
      if (path.endsWith("/heartbeat-challenge")) {
        throw new PreviewAgentClientError(
          "PREVIEW_AGENT_HEARTBEAT_REJECTED",
        );
      }
      throw new PreviewAgentClientError(
        "PREVIEW_AGENT_HEARTBEAT_RETRY",
        PREVIEW_AGENT_CHALLENGE_TTL_MS + 1_000,
      );
    }
    if (path.endsWith("/preview-agent-pairings/complete")) {
      throw new PreviewAgentClientError("PREVIEW_AGENT_PAIRING_REJECTED");
    }
    throw new PreviewAgentClientError(
      "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    );
  }
  return payload;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isIsoDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function waitForAbortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
