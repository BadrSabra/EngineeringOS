import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createPreviewAgentHeartbeatChallenge,
  previewAgentPublicKeyFingerprint,
  verifyPreviewAgentHeartbeatChallengeRequest,
  verifyPreviewAgentHeartbeatProof,
  verifyPreviewAgentPairingProof,
} from "@workspace/preview-agent-contract";
import {
  pairPreviewAgent,
  sendPreviewAgentHeartbeat,
  type PreviewAgentFetch,
} from "./client.js";
import type {
  PreviewAgentIdentity,
} from "./identity.js";
import type {
  PreviewAgentSecretStore,
} from "./linux-secret-service.js";

const nodeId = "a462a6c3-e2fa-49bb-a228-3e5a61330115";
const storeId = "bb550bc3-1930-4285-a33c-460b52dc8ea7";
const pairingCode = "a".repeat(43);
const now = new Date("2026-11-13T12:00:00.000Z");
const apiUrl = "https://engineeringos.example";

class MemorySecretStore implements PreviewAgentSecretStore {
  readonly records = new Map<string, PreviewAgentIdentity>();

  async get(id: string) {
    const value = this.records.get(id);
    return value ? structuredClone(value) : null;
  }

  async set(identity: PreviewAgentIdentity) {
    this.records.set(identity.nodeId, structuredClone(identity));
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}

function activeIdentity(): PreviewAgentIdentity {
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    version: 1,
    state: "active",
    nodeId,
    storeId,
    keyVersion: 1,
    publicKeyPem: keys.publicKey,
    privateKeyPem: keys.privateKey,
    fingerprint: previewAgentPublicKeyFingerprint(keys.publicKey),
    sequence: 0,
  };
}

function asFetch(handler: (url: URL, init: RequestInit) => Promise<Response>) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      input instanceof URL
        ? input
        : input instanceof Request
          ? new URL(input.url)
          : new URL(input);
    return handler(url, init ?? {});
  }) as PreviewAgentFetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Preview Agent local heartbeat client", () => {
  it("stores the private key before completing pairing and sends only its public key", async () => {
    const store = new MemorySecretStore();
    const fetchImpl = asFetch(async (url, init) => {
      expect(url.pathname).toBe("/api/preview-agent-pairings/complete");
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      const body = JSON.parse(String(init.body)) as {
        pairingCode: string;
        storeId: string;
        publicKeyPem: string;
        proof: string;
        platform: string;
      };
      expect(body.platform).toBe("linux");
      expect(body.storeId).toBe(storeId);
      expect(body.pairingCode).toBe(pairingCode);
      expect(JSON.stringify(body)).not.toContain("privateKeyPem");
      const fingerprint = verifyPreviewAgentPairingProof({
        pairingCode: body.pairingCode,
        nodeId,
        storeId,
        expiresAt: new Date("2026-11-13T12:10:00.000Z"),
        publicKeyPem: body.publicKeyPem,
        proof: body.proof,
      });
      expect(fingerprint).toBe(
        previewAgentPublicKeyFingerprint(body.publicKeyPem),
      );
      return jsonResponse({
        nodeId,
        storeId,
        status: "active",
        keyVersion: 1,
        fingerprint,
      });
    });

    const paired = await pairPreviewAgent({
      apiUrl,
      nodeId,
      storeId,
      pairingCode,
      pairingExpiresAt: "2026-11-13T12:10:00.000Z",
      secretStore: store,
      fetchImpl,
      now,
    });
    const stored = await store.get(nodeId);

    expect(paired).toMatchObject({ nodeId, keyVersion: 1 });
    expect(stored?.state).toBe("active");
    expect(stored?.pairing).toBeUndefined();
    expect(stored?.privateKeyPem).toContain("PRIVATE KEY");
  });

  it("reuses the same persisted pairing key after a lost response", async () => {
    const store = new MemorySecretStore();
    let call = 0;
    let firstPublicKey = "";
    let firstProof = "";
    const fetchImpl = asFetch(async (_url, init) => {
      call += 1;
      const body = JSON.parse(String(init.body)) as {
        publicKeyPem: string;
        proof: string;
      };
      if (call === 1) {
        firstPublicKey = body.publicKeyPem;
        firstProof = body.proof;
        throw new Error("response lost");
      }
      expect(body.publicKeyPem).toBe(firstPublicKey);
      expect(body.proof).toBe(firstProof);
      return jsonResponse({
        nodeId,
        storeId,
        status: "active",
        keyVersion: 1,
        fingerprint: previewAgentPublicKeyFingerprint(body.publicKeyPem),
      });
    });
    const args = {
      apiUrl,
      nodeId,
      storeId,
      pairingCode,
      pairingExpiresAt: "2026-11-13T12:10:00.000Z",
      secretStore: store,
      fetchImpl,
      now,
    };

    await expect(pairPreviewAgent(args)).rejects.toMatchObject({
      code: "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    });
    const savedAfterFailure = await store.get(nodeId);
    expect(savedAfterFailure?.state).toBe("pairing");
    await pairPreviewAgent(args);
    expect((await store.get(nodeId))?.state).toBe("active");
    expect(call).toBe(2);
  });

  it("does not activate a key when the API reports another fingerprint", async () => {
    const store = new MemorySecretStore();
    const fetchImpl = asFetch(async () =>
      jsonResponse({
        nodeId,
        storeId,
        status: "active",
        keyVersion: 1,
        fingerprint: "0".repeat(64),
      }),
    );

    await expect(
      pairPreviewAgent({
        apiUrl,
        nodeId,
        storeId,
        pairingCode,
        pairingExpiresAt: "2026-11-13T12:10:00.000Z",
        secretStore: store,
        fetchImpl,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    });
    expect((await store.get(nodeId))?.state).toBe("pairing");
  });

  it("signs both heartbeat steps and persists the sequence before network I/O", async () => {
    const store = new MemorySecretStore();
    const identity = activeIdentity();
    await store.set(identity);
    const challenge = createPreviewAgentHeartbeatChallenge();
    const calls: string[] = [];
    const fetchImpl = asFetch(async (url, init) => {
      calls.push(url.pathname);
      const body = JSON.parse(String(init.body)) as {
        proof: Record<string, unknown>;
        signature: string;
      };
      expect(init.credentials).toBe("omit");
      expect(init.headers).toMatchObject({
        accept: "application/json",
        "content-type": "application/json",
      });
      if (url.pathname.endsWith("/heartbeat-challenge")) {
        expect(body.proof).toMatchObject({
          version: 1,
          action: "request-preview-agent-heartbeat-challenge",
          nodeId,
          keyVersion: 1,
          sequence: 1,
        });
        verifyPreviewAgentHeartbeatChallengeRequest({
          ...(body.proof as {
            nodeId: string;
            keyVersion: number;
            sequence: number;
            nonce: string;
          }),
          publicKeyPem: identity.publicKeyPem,
          signature: body.signature,
        });
        expect((await store.get(nodeId))?.sequence).toBe(1);
        return jsonResponse({
          nodeId,
          keyVersion: 1,
          challenge,
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        });
      }
      verifyPreviewAgentHeartbeatProof({
        ...(body.proof as {
          version: 1;
          action: "preview-agent-heartbeat";
          nodeId: string;
          keyVersion: number;
          sequence: number;
          challenge: string;
        }),
        publicKeyPem: identity.publicKeyPem,
        signature: body.signature,
      });
      return jsonResponse({
        nodeId,
        sequence: 1,
        lastSeenAt: now.toISOString(),
        alreadyAccepted: false,
      });
    });

    const result = await sendPreviewAgentHeartbeat({
      apiUrl,
      nodeId,
      secretStore: store,
      fetchImpl,
      now,
    });
    const final = await store.get(nodeId);

    expect(calls).toEqual([
      `/api/internal/preview-agents/${nodeId}/heartbeat-challenge`,
      `/api/internal/preview-agents/${nodeId}/heartbeat`,
    ]);
    expect(result).toEqual({
      nodeId,
      sequence: 1,
      lastSeenAt: now.toISOString(),
    });
    expect(final?.sequence).toBe(1);
    expect(final?.pendingHeartbeat).toBeUndefined();
    expect(final?.lastChallengeRequestedAt).toBeUndefined();
    expect(final?.lastSeenAt).toBe(now.toISOString());
  });

  it("retries the exact signed heartbeat after a lost acceptance response", async () => {
    const store = new MemorySecretStore();
    const identity = activeIdentity();
    await store.set(identity);
    const challenge = createPreviewAgentHeartbeatChallenge();
    let challengeCalls = 0;
    let heartbeatCalls = 0;
    let signedProof = "";
    const fetchImpl = asFetch(async (url, init) => {
      const body = JSON.parse(String(init.body)) as {
        proof: Record<string, unknown>;
        signature: string;
      };
      if (url.pathname.endsWith("/heartbeat-challenge")) {
        challengeCalls += 1;
        return jsonResponse({
          nodeId,
          keyVersion: 1,
          challenge,
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        });
      }
      heartbeatCalls += 1;
      const serialized = JSON.stringify(body);
      if (!signedProof) {
        signedProof = serialized;
        throw new Error("response lost after server acceptance");
      }
      expect(serialized).toBe(signedProof);
      return jsonResponse({
        nodeId,
        sequence: 1,
        lastSeenAt: now.toISOString(),
        alreadyAccepted: true,
      });
    });

    await expect(
      sendPreviewAgentHeartbeat({
        apiUrl,
        nodeId,
        secretStore: store,
        fetchImpl,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    });
    expect((await store.get(nodeId))?.pendingHeartbeat).toBeDefined();
    await sendPreviewAgentHeartbeat({
      apiUrl,
      nodeId,
      secretStore: store,
      fetchImpl,
      now: new Date(now.getTime() + 1_000),
    });

    expect(challengeCalls).toBe(1);
    expect(heartbeatCalls).toBe(2);
    expect((await store.get(nodeId))?.pendingHeartbeat).toBeUndefined();
  });

  it("does not reuse a reserved challenge sequence when the response is lost", async () => {
    const store = new MemorySecretStore();
    await store.set(activeIdentity());
    const fetchImpl = vi.fn(async () => {
      throw new Error("network unavailable");
    }) as unknown as PreviewAgentFetch;

    await expect(
      sendPreviewAgentHeartbeat({
        apiUrl,
        nodeId,
        secretStore: store,
        fetchImpl,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    });
    const reserved = await store.get(nodeId);
    expect(reserved?.sequence).toBe(1);
    expect(reserved?.lastChallengeRequestedAt).toBe(now.toISOString());
    await expect(
      sendPreviewAgentHeartbeat({
        apiUrl,
        nodeId,
        secretStore: store,
        fetchImpl,
        now: new Date(now.getTime() + 20_000),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_HEARTBEAT_RETRY",
      retryAfterMs: 41_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects non-HTTPS server URLs but permits explicit loopback development", async () => {
    const store = new MemorySecretStore();
    await expect(
      pairPreviewAgent({
        apiUrl: "http://agent.example",
        nodeId,
        storeId,
        pairingCode,
        pairingExpiresAt: "2026-11-13T12:10:00.000Z",
        secretStore: store,
        fetchImpl: asFetch(async () => jsonResponse({})),
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_SERVER_URL_INVALID",
    });
    const fetchImpl = asFetch(async (url, init) => {
      expect(url.origin).toBe("http://127.0.0.1:8080");
      const body = JSON.parse(String(init.body)) as { publicKeyPem: string };
      return jsonResponse({
        nodeId,
        storeId,
        status: "active",
        keyVersion: 1,
        fingerprint: previewAgentPublicKeyFingerprint(body.publicKeyPem),
      });
    });
    await expect(
      pairPreviewAgent({
        apiUrl: "http://127.0.0.1:8080",
        nodeId,
        storeId,
        pairingCode,
        pairingExpiresAt: "2026-11-13T12:10:00.000Z",
        secretStore: store,
        fetchImpl,
        now,
      }),
    ).resolves.toMatchObject({ nodeId, keyVersion: 1 });
  });
});
