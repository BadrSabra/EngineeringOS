import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createPreviewAgentHeartbeatChallenge,
  previewArtifactDeleteCommandFingerprint,
  previewArtifactDeleteCommandId,
  previewAgentPublicKeyFingerprint,
  signPreviewArtifactDeleteCommand,
  signPreviewArtifactDeleteReceipt,
  verifyPreviewArtifactDeletePollProof,
  verifyPreviewArtifactDeleteReceipt,
  verifyPreviewAgentHeartbeatChallengeRequest,
  verifyPreviewAgentHeartbeatProof,
  verifyPreviewAgentPairingProof,
  type PreviewArtifactDeleteCommandClaims,
} from "@workspace/preview-agent-contract";
import {
  pairPreviewAgent,
  processPreviewAgentArtifactDeleteCommand,
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
const commandKeys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

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

function deleteCommand(now: Date): {
  claims: PreviewArtifactDeleteCommandClaims;
  token: string;
} {
  const gcLeaseAt = new Date(now.getTime() - 60_000).toISOString();
  const fields = {
    version: 2 as const,
    action: "delete-artifact" as const,
    commandId: "",
    nodeId,
    keyVersion: 1,
    storeId,
    artifactRefId: "c81b38f7-7f24-48af-bd6f-bdafd8aa8111",
    jobId: "8f76d6c3-195d-49ad-a4a2-6ae916de7a40",
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 3,
    candidateRevision: "a".repeat(64),
    changeSetHash: "b".repeat(64),
    artifactKind: "preview-build-input" as const,
    artifactDigest: "c".repeat(64),
    sizeBytes: 1024,
    manifestDigest: "d".repeat(64),
    retentionPolicy: "preview-build-input-24h-v1" as const,
    gcLeaseAt,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  };
  const claims = {
    ...fields,
    commandId: previewArtifactDeleteCommandId({
      nodeId,
      keyVersion: 1,
      jobId: fields.jobId,
      artifactRefId: fields.artifactRefId,
      gcLeaseAt,
    }),
  };
  return {
    claims,
    token: signPreviewArtifactDeleteCommand({
      claims,
      privateKeyPem: commandKeys.privateKey,
      now,
    }),
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
        publicKeyFingerprint: fingerprint,
        commandPublicKeyPem: commandKeys.publicKey,
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
    expect(stored?.commandPublicKeyPem).toBe(commandKeys.publicKey);
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
        publicKeyFingerprint: previewAgentPublicKeyFingerprint(body.publicKeyPem),
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
        publicKeyFingerprint: "0".repeat(64),
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
        publicKeyFingerprint: previewAgentPublicKeyFingerprint(body.publicKeyPem),
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

  it("verifies a signed delete command and persists its receipt before submission", async () => {
    const secretStore = new MemorySecretStore();
    const identity = activeIdentity();
    identity.commandPublicKeyPem = commandKeys.publicKey;
    await secretStore.set(identity);
    const { claims, token } = deleteCommand(now);
    let removed = 0;
    let savedReceiptToken = "";
    const fetchImpl = asFetch(async (url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(init.credentials).toBe("omit");
      if (url.pathname.endsWith("/artifact-delete-command")) {
        const proofBody = body as {
          proof: Parameters<typeof verifyPreviewArtifactDeletePollProof>[0]["proof"];
          signature: string;
        };
        expect(
          verifyPreviewArtifactDeletePollProof({
            proof: proofBody.proof,
            signature: proofBody.signature,
            publicKeyPem: identity.publicKeyPem,
            now,
          }),
        ).toMatchObject({ nodeId, jobId: claims.jobId });
        return jsonResponse({
          commandId: claims.commandId,
          commandFingerprint: previewArtifactDeleteCommandFingerprint(claims),
          expiresAt: claims.expiresAt,
          commandToken: token,
        });
      }
      expect(url.pathname).toBe(
        `/api/internal/preview-build-jobs/${claims.jobId}/artifact-delete-receipt`,
      );
      const receiptBody = body as {
        commandToken: string;
        receiptToken: string;
      };
      const saved = await secretStore.get(nodeId);
      savedReceiptToken = saved?.pendingArtifactDelete?.receiptToken ?? "";
      expect(savedReceiptToken).toBe(receiptBody.receiptToken);
      expect(receiptBody.commandToken).toBe(token);
      expect(
        verifyPreviewArtifactDeleteReceipt({
          token: receiptBody.receiptToken,
          publicKeyPem: identity.publicKeyPem,
          command: claims,
          now,
        }),
      ).toMatchObject({ result: "deleted", artifactRefId: claims.artifactRefId });
      return jsonResponse({
        jobId: claims.jobId,
        artifactDeleted: true,
        alreadyAccepted: false,
      });
    });

    const result = await processPreviewAgentArtifactDeleteCommand({
      apiUrl,
      nodeId,
      jobId: claims.jobId,
      secretStore,
      fetchImpl,
      now,
      artifactStore: {
        async removeReference(input) {
          removed += 1;
          expect(input).toMatchObject({
            storeId,
            jobId: claims.jobId,
            artifactRefId: claims.artifactRefId,
            expectedDigest: claims.artifactDigest,
            expectedSizeBytes: claims.sizeBytes,
            expectedManifestDigest: claims.manifestDigest,
            candidateRevision: claims.candidateRevision,
          });
          return "deleted";
        },
      },
    });

    expect(result).toEqual({
      state: "accepted",
      jobId: claims.jobId,
      alreadyAccepted: false,
    });
    expect(removed).toBe(1);
    expect(savedReceiptToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect((await secretStore.get(nodeId))?.pendingArtifactDelete).toBeUndefined();
  });

  it("retries the exact durable receipt after a lost response without deleting twice", async () => {
    const secretStore = new MemorySecretStore();
    const identity = activeIdentity();
    identity.commandPublicKeyPem = commandKeys.publicKey;
    await secretStore.set(identity);
    const { claims, token } = deleteCommand(now);
    let pollCount = 0;
    let deleteCount = 0;
    let receiptCount = 0;
    const receipts: string[] = [];
    const fetchImpl = asFetch(async (url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (url.pathname.endsWith("/artifact-delete-command")) {
        pollCount += 1;
        return jsonResponse({
          commandId: claims.commandId,
          commandFingerprint: previewArtifactDeleteCommandFingerprint(claims),
          expiresAt: claims.expiresAt,
          commandToken: token,
        });
      }
      const receipt = body.receiptToken as string;
      receipts.push(receipt);
      receiptCount += 1;
      if (receiptCount === 1) throw new Error("receipt response lost");
      return jsonResponse({
        jobId: claims.jobId,
        artifactDeleted: true,
        alreadyAccepted: true,
      });
    });
    const artifactStore = {
      async removeReference() {
        deleteCount += 1;
        return "deleted" as const;
      },
    };
    const input = {
      apiUrl,
      nodeId,
      jobId: claims.jobId,
      secretStore,
      artifactStore,
      fetchImpl,
      now,
    };

    await expect(processPreviewAgentArtifactDeleteCommand(input)).rejects
      .toMatchObject({ code: "PREVIEW_AGENT_ARTIFACT_DELETE_RETRY" });
    const pending = (await secretStore.get(nodeId))?.pendingArtifactDelete;
    expect(pending?.receiptToken).toBeTruthy();
    await expect(
      processPreviewAgentArtifactDeleteCommand({
        ...input,
        jobId: "94cc6266-181a-44f9-90f8-bdd21ebcc748",
      }),
    ).resolves.toEqual({
      state: "accepted",
      jobId: claims.jobId,
      alreadyAccepted: true,
    });

    expect(pollCount).toBe(1);
    expect(deleteCount).toBe(1);
    expect(receiptCount).toBe(2);
    expect(receipts[0]).toBe(receipts[1]);
    expect((await secretStore.get(nodeId))?.pendingArtifactDelete).toBeUndefined();
  });

  it("refreshes an expired receipt after a long outage and rechecks the reference", async () => {
    const secretStore = new MemorySecretStore();
    const identity = activeIdentity();
    identity.commandPublicKeyPem = commandKeys.publicKey;

    const oldIssuedAt = new Date(now.getTime() - 6 * 60_000);
    const old = deleteCommand(oldIssuedAt);
    const oldCompletedAt = new Date(oldIssuedAt.getTime() + 20_000);
    const oldReceiptToken = signPreviewArtifactDeleteReceipt({
      claims: {
        version: 2,
        action: "artifact-delete-receipt",
        commandId: old.claims.commandId,
        commandFingerprint:
          previewArtifactDeleteCommandFingerprint(old.claims),
        nodeId,
        keyVersion: 1,
        storeId,
        artifactRefId: old.claims.artifactRefId,
        artifactDigest: old.claims.artifactDigest,
        manifestDigest: old.claims.manifestDigest,
        result: "deleted",
        completedAt: oldCompletedAt.toISOString(),
      },
      privateKeyPem: identity.privateKeyPem,
      now: oldCompletedAt,
    });
    identity.pendingArtifactDelete = {
      jobId: old.claims.jobId,
      commandToken: old.token,
      receiptToken: oldReceiptToken,
    };
    await secretStore.set(identity);

    const current = deleteCommand(now);
    let pollCount = 0;
    let receiptCount = 0;
    let referenceChecks = 0;
    const fetchImpl = asFetch(async (url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (url.pathname.endsWith("/artifact-delete-command")) {
        pollCount += 1;
        return jsonResponse({
          commandId: current.claims.commandId,
          commandFingerprint:
            previewArtifactDeleteCommandFingerprint(current.claims),
          expiresAt: current.claims.expiresAt,
          commandToken: current.token,
        });
      }
      receiptCount += 1;
      expect(body.commandToken).toBe(current.token);
      expect(body.receiptToken).not.toBe(oldReceiptToken);
      return jsonResponse({
        jobId: current.claims.jobId,
        artifactDeleted: true,
        alreadyAccepted: false,
      });
    });

    await expect(
      processPreviewAgentArtifactDeleteCommand({
        apiUrl,
        nodeId,
        jobId: old.claims.jobId,
        secretStore,
        fetchImpl,
        now,
        artifactStore: {
          async removeReference(input) {
            referenceChecks += 1;
            expect(input.artifactRefId).toBe(current.claims.artifactRefId);
            return "already_deleted";
          },
        },
      }),
    ).resolves.toEqual({
      state: "accepted",
      jobId: current.claims.jobId,
      alreadyAccepted: false,
    });

    expect(pollCount).toBe(1);
    expect(referenceChecks).toBe(1);
    expect(receiptCount).toBe(1);
    expect((await secretStore.get(nodeId))?.pendingArtifactDelete).toBeUndefined();
  });

  it("rejects a validly signed command for another store before touching the store", async () => {
    const secretStore = new MemorySecretStore();
    const identity = activeIdentity();
    identity.commandPublicKeyPem = commandKeys.publicKey;
    await secretStore.set(identity);
    const { claims: validClaims } = deleteCommand(now);
    const claims = {
      ...validClaims,
      storeId: "94cc6266-181a-44f9-90f8-bdd21ebcc748",
    };
    const token = signPreviewArtifactDeleteCommand({
      claims,
      privateKeyPem: commandKeys.privateKey,
      now,
    });
    let removed = false;
    const fetchImpl = asFetch(async () =>
      jsonResponse({
        commandId: claims.commandId,
        commandFingerprint: previewArtifactDeleteCommandFingerprint(claims),
        expiresAt: claims.expiresAt,
        commandToken: token,
      }),
    );

    await expect(
      processPreviewAgentArtifactDeleteCommand({
        apiUrl,
        nodeId,
        jobId: claims.jobId,
        secretStore,
        fetchImpl,
        now,
        artifactStore: {
          async removeReference() {
            removed = true;
            return "deleted";
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_CLIENT_RESPONSE_INVALID",
    });
    expect(removed).toBe(false);
  });
});
