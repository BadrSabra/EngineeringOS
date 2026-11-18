import express, { type RequestHandler } from "express";
import { generateKeyPairSync } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PreviewAgentNodeSummary,
} from "../lib/preview-agent-pairing.js";
import { PreviewAgentCapabilityError } from "../lib/preview-agent-capability.js";
import type { PreviewBuildJob } from "@workspace/db";
import { PreviewArtifactStoreAcceptanceError } from "../lib/preview-artifact-store-acceptance.js";
import { PreviewArtifactStoreCommandIssueError } from "../lib/preview-artifact-store-issuer.js";
import { PreviewArtifactGcAcceptanceError } from "../lib/preview-artifact-gc-acceptance.js";
import { previewArtifactDeleteCommandPublicKeyPem } from "../lib/preview-artifact-gc-command.js";
import {
  PreviewArtifactGcCommandIssueError,
  type PreviewArtifactGcCommandIssue,
} from "../lib/preview-artifact-gc-issuer.js";
import { PreviewRunnerMessageAcceptanceError } from "../lib/preview-runner-message-acceptance.js";
import { PreviewRunnerCommandIssueError } from "../lib/preview-runner-command-issuer.js";
import { createPreviewAgentRouter } from "./preview-agents.js";

const pairing = {
  nodeId: "d69b66c5-9cb9-4c9a-ae60-1cc578c40700",
  storeId: "e3397306-4254-4a5c-a5e8-3a48968751dd",
  pairingCode: "A".repeat(43),
  expiresAt: new Date("2031-03-04T12:10:00.000Z"),
};
const commandSigningKeys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const runnerCommandSigningKeys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const node: PreviewAgentNodeSummary = {
  nodeId: pairing.nodeId,
  projectId: "project-1",
  storeId: pairing.storeId,
  status: "active",
  publicKeyFingerprint: "a".repeat(64),
  agentVersion: "1.2.3",
  platform: "linux",
  keyVersion: 1,
  pairingExpiresAt: pairing.expiresAt,
  pairedAt: new Date("2031-03-04T12:00:00.000Z"),
  lastSeenAt: null,
  revokedAt: null,
  createdAt: new Date("2031-03-04T12:00:00.000Z"),
};

function createApp(options: { production?: boolean } = {}) {
  const auth: RequestHandler = (req, _res, next) => {
    req.userId = "user-1";
    next();
  };
  const projectAccess: RequestHandler = (req, _res, next) => {
    req.userId = "user-1";
    next();
  };
  const dependencies = {
    requireAuth: auth,
    requireProjectAccess: projectAccess,
    requireProjectWriteAccess: projectAccess,
    createPairing: vi.fn(async () => pairing),
    completePairing: vi.fn(async () => node),
    submitCapabilityReport: vi.fn(async (input: { nodeId: string }) => ({
      nodeId: input.nodeId,
      expiresAt: new Date("2031-03-04T12:00:30.000Z"),
    })),
    acceptArtifactStoreReceipt: vi.fn(async ({ jobId }: { jobId: string }) => ({
      job: {
        jobId,
        stateVersion: 4,
        inputArtifactReadyAt: new Date("2031-03-04T12:00:02.000Z"),
      } as PreviewBuildJob,
      alreadyAccepted: false,
    })),
    issueArtifactStoreCommand: vi.fn(async ({ jobId }: { jobId: string }) => ({
      commandId: "223e4567-e89b-42d3-a456-426614174001",
      commandFingerprint: "a".repeat(64),
      expiresAt: new Date("2031-03-04T12:00:30.000Z"),
      commandToken: `signed-command-for-${jobId}`,
    })),
    acceptArtifactDeleteReceipt: vi.fn(async ({ jobId }: { jobId: string }) => ({
      job: {
        jobId,
        stateVersion: 6,
        inputArtifactGcState: "deleted",
      } as PreviewBuildJob,
      alreadyAccepted: false,
    })),
    issueArtifactDeleteCommand: vi.fn(
      async ({
        jobId,
      }: {
        jobId: string;
      }): Promise<PreviewArtifactGcCommandIssue | null> => ({
        commandId: "323e4567-e89b-42d3-a456-426614174002",
        commandFingerprint: "b".repeat(64),
        expiresAt: new Date("2031-03-04T12:00:30.000Z"),
        commandToken: `signed-delete-command-for-${jobId}`,
      }),
    ),
    issueHeartbeatChallenge: vi.fn(
      async ({
        proof,
      }: {
        proof: { nodeId: string; keyVersion: number };
        signature: string;
      }) => ({
        nodeId: proof.nodeId,
        keyVersion: proof.keyVersion,
        challenge: "C".repeat(43),
        expiresAt: new Date("2031-03-04T12:01:00.000Z"),
      }),
    ),
    acceptHeartbeat: vi.fn(
      async ({
        proof,
      }: {
        proof: { nodeId: string; sequence: number };
        signature: string;
      }) => ({
        nodeId: proof.nodeId,
        sequence: proof.sequence,
        lastSeenAt: new Date("2031-03-04T12:00:01.000Z"),
        alreadyAccepted: false,
      }),
    ),
    acceptRunnerMessage: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      stateVersion: 8,
      action: "observe" as const,
      messageType: "observation" as const,
      alreadyAccepted: false,
      observedState: "ready",
    })),
    issueRunnerCommand: vi.fn(async () => ({
      commandId: "423e4567-e89b-42d3-a456-426614174003",
      fencingGeneration: 4,
      expiresAt: new Date("2031-03-04T12:00:30.000Z"),
      commandToken: "short-lived.signed-command",
    })),
    buildJobPrivateKeyPem: commandSigningKeys.privateKey,
    runnerCommandPrivateKeyPem: runnerCommandSigningKeys.privateKey,
    listNodes: vi.fn(async () => [node]),
    revokeNode: vi.fn(async () => ({ ...node, status: "revoked" as const, revokedAt: node.createdAt })),
    isProduction: options.production ?? false,
    completionRateLimiter: ((_req, _res, next) => next()) as RequestHandler,
    capabilityRateLimiter: ((_req, _res, next) => next()) as RequestHandler,
  };
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(createPreviewAgentRouter(dependencies));
  return { app, dependencies };
}

describe("Preview Agent pairing routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the pairing code once and does not expose a private key", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post("/projects/project-1/preview-agents/pairings")
      .send({ storeId: pairing.storeId });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      nodeId: pairing.nodeId,
      storeId: pairing.storeId,
      pairingCode: pairing.pairingCode,
      expiresAt: pairing.expiresAt.toISOString(),
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(dependencies.createPairing).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
      storeId: pairing.storeId,
    });
  });

  it("rejects malformed completion payloads before calling the owner registry", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post("/preview-agent-pairings/complete")
      .send({
        pairingCode: pairing.pairingCode,
        storeId: pairing.storeId,
        publicKeyPem: "not-a-key",
        proof: "x".repeat(86),
        agentVersion: "1.0.0",
        platform: "linux",
        filesystemPath: "/home/user/project",
      });

    expect(response.status).toBe(400);
    expect(dependencies.completePairing).not.toHaveBeenCalled();
  });

  it("completes without Clerk cookies and returns only the registered key fingerprint", async () => {
    const { app, dependencies } = createApp();
    const body = {
      pairingCode: pairing.pairingCode,
      storeId: pairing.storeId,
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\npublic-only\n-----END PUBLIC KEY-----",
      proof: "p".repeat(86),
      agentVersion: "1.2.3",
      platform: "linux",
    };
    const response = await request(app)
      .post("/preview-agent-pairings/complete")
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      nodeId: node.nodeId,
      storeId: node.storeId,
      status: "active",
      publicKeyFingerprint: node.publicKeyFingerprint,
      keyVersion: node.keyVersion,
      pairedAt: node.pairedAt!.toISOString(),
      commandPublicKeyPem: previewArtifactDeleteCommandPublicKeyPem(
        commandSigningKeys.privateKey,
      ),
      runnerCommandPublicKeyPem: runnerCommandSigningKeys.publicKey,
    });
    expect(response.body).not.toHaveProperty("publicKeyPem");
    expect(dependencies.completePairing).toHaveBeenCalledWith(body);
  });

  it("rejects cookies and plaintext completion in production", async () => {
    const { app, dependencies } = createApp({ production: true });
    const body = {
      pairingCode: pairing.pairingCode,
      storeId: pairing.storeId,
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\npublic-only\n-----END PUBLIC KEY-----",
      proof: "p".repeat(86),
      agentVersion: "1.2.3",
      platform: "linux",
    };
    const cookieResponse = await request(app)
      .post("/preview-agent-pairings/complete")
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app)
      .post("/preview-agent-pairings/complete")
      .send(body);
    const secureResponse = await request(app)
      .post("/preview-agent-pairings/complete")
      .set("x-forwarded-proto", "https")
      .send(body);

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(secureResponse.status).toBe(200);
    expect(dependencies.completePairing).toHaveBeenCalledTimes(1);
  });

  it("accepts a signed capability report without returning its token", async () => {
    const { app, dependencies } = createApp();
    const token = "signed-report-token";
    const response = await request(app)
      .post(`/preview-agent-capabilities/${node.nodeId}/report`)
      .send({
        qualificationRecordId: "11111111-1111-4111-8111-111111111111",
        token,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      nodeId: node.nodeId,
      accepted: true,
      expiresAt: "2031-03-04T12:00:30.000Z",
    });
    expect(response.body).not.toHaveProperty("token");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(dependencies.submitCapabilityReport).toHaveBeenCalledWith({
      nodeId: node.nodeId,
      qualificationRecordId: "11111111-1111-4111-8111-111111111111",
      token,
    });
  });

  it("rejects malformed capability reports before verification", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post(`/preview-agent-capabilities/${node.nodeId}/report`)
      .send({
        qualificationRecordId: "not-a-uuid",
        token: "x",
        privateKey: "must-not-be-accepted",
      });

    expect(response.status).toBe(400);
    expect(dependencies.submitCapabilityReport).not.toHaveBeenCalled();
  });

  it("rejects cookies and plaintext capability reports in production", async () => {
    const { app, dependencies } = createApp({ production: true });
    const body = {
      qualificationRecordId: "11111111-1111-4111-8111-111111111111",
      token: "signed-report-token",
    };
    const cookieResponse = await request(app)
      .post(`/preview-agent-capabilities/${node.nodeId}/report`)
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app)
      .post(`/preview-agent-capabilities/${node.nodeId}/report`)
      .send(body);

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(dependencies.submitCapabilityReport).not.toHaveBeenCalled();
  });

  it("keeps unsupported isolation explicit instead of accepting a report", async () => {
    const { app, dependencies } = createApp();
    vi.mocked(dependencies.submitCapabilityReport).mockRejectedValueOnce(
      new PreviewAgentCapabilityError(
        "PREVIEW_AGENT_CAPABILITY_UNQUALIFIED",
      ),
    );
    const response = await request(app)
      .post(`/preview-agent-capabilities/${node.nodeId}/report`)
      .send({
        qualificationRecordId: "11111111-1111-4111-8111-111111111111",
        token: "signed-report-token",
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "preview_agent_capability_unsupported",
    });
  });

  it("issues a short-lived heartbeat challenge without exposing node keys", async () => {
    const { app, dependencies } = createApp();
    const body = {
      proof: {
        version: 1,
        action: "request-preview-agent-heartbeat-challenge",
        nodeId: node.nodeId,
        keyVersion: 1,
        sequence: 1,
        nonce: "8a42c6b1-5d54-4d4b-a854-64453c037d43",
      },
      signature: "S".repeat(86),
    };
    const response = await request(app)
      .post(`/internal/preview-agents/${node.nodeId}/heartbeat-challenge`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      nodeId: node.nodeId,
      keyVersion: 1,
      challenge: "C".repeat(43),
      expiresAt: "2031-03-04T12:01:00.000Z",
    });
    expect(response.body).not.toHaveProperty("publicKeyPem");
    expect(dependencies.issueHeartbeatChallenge).toHaveBeenCalledWith(body);
  });

  it("rejects heartbeat challenge requests with cookies or plaintext in production", async () => {
    const { app, dependencies } = createApp({ production: true });
    const body = {
      proof: {
        version: 1,
        action: "request-preview-agent-heartbeat-challenge",
        nodeId: node.nodeId,
        keyVersion: 1,
        sequence: 1,
        nonce: "8a42c6b1-5d54-4d4b-a854-64453c037d43",
      },
      signature: "S".repeat(86),
    };
    const cookieResponse = await request(app)
      .post(`/internal/preview-agents/${node.nodeId}/heartbeat-challenge`)
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app).post(
      `/internal/preview-agents/${node.nodeId}/heartbeat-challenge`,
    );

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(dependencies.issueHeartbeatChallenge).not.toHaveBeenCalled();
  });

  it("rejects heartbeat challenge identity mismatches before verification", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post(`/internal/preview-agents/${node.nodeId}/heartbeat-challenge`)
      .send({
        proof: {
          version: 1,
          action: "request-preview-agent-heartbeat-challenge",
          nodeId: "94cc6266-181a-44f9-90f8-bdd21ebcc748",
          keyVersion: 1,
          sequence: 1,
          nonce: "8a42c6b1-5d54-4d4b-a854-64453c037d43",
        },
        signature: "S".repeat(86),
      });

    expect(response.status).toBe(400);
    expect(dependencies.issueHeartbeatChallenge).not.toHaveBeenCalled();
  });

  it("accepts a signed-heartbeat contract without returning the signature", async () => {
    const { app, dependencies } = createApp();
    const signature = "S".repeat(86);
    const proof = {
      version: 1,
      action: "preview-agent-heartbeat",
      nodeId: node.nodeId,
      keyVersion: 1,
      sequence: 7,
      challenge: "C".repeat(43),
    };
    const response = await request(app)
      .post(`/internal/preview-agents/${node.nodeId}/heartbeat`)
      .send({ proof, signature });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      nodeId: node.nodeId,
      sequence: 7,
      lastSeenAt: "2031-03-04T12:00:01.000Z",
      alreadyAccepted: false,
    });
    expect(response.body).not.toHaveProperty("signature");
    expect(dependencies.acceptHeartbeat).toHaveBeenCalledWith({
      proof,
      signature,
    });
  });

  it("rejects heartbeat route identity mismatches before verification", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post(`/internal/preview-agents/${node.nodeId}/heartbeat`)
      .send({
        proof: {
          version: 1,
          action: "preview-agent-heartbeat",
          nodeId: "94cc6266-181a-44f9-90f8-bdd21ebcc748",
          keyVersion: 1,
          sequence: 1,
          challenge: "C".repeat(43),
        },
        signature: "S".repeat(86),
      });

    expect(response.status).toBe(400);
    expect(dependencies.acceptHeartbeat).not.toHaveBeenCalled();
  });

  it("rejects cookies and plaintext signed heartbeats in production", async () => {
    const { app, dependencies } = createApp({ production: true });
    const body = {
      proof: {
        version: 1,
        action: "preview-agent-heartbeat",
        nodeId: node.nodeId,
        keyVersion: 1,
        sequence: 1,
        challenge: "C".repeat(43),
      },
      signature: "S".repeat(86),
    };
    const cookieResponse = await request(app)
      .post(`/internal/preview-agents/${node.nodeId}/heartbeat`)
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app)
      .post(`/internal/preview-agents/${node.nodeId}/heartbeat`)
      .send(body);

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(dependencies.acceptHeartbeat).not.toHaveBeenCalled();
  });

  it("accepts only a bounded signed Runner token and returns a safe projection", async () => {
    const { app, dependencies } = createApp();
    const sessionId = "923e4567-e89b-42d3-a456-426614174003";
    const token = "opaque.signed-runner-message";
    const response = await request(app)
      .post(`/internal/preview-sessions/${sessionId}/runner-message`)
      .send({ token });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      sessionId,
      stateVersion: 8,
      action: "observe",
      messageType: "observation",
      alreadyAccepted: false,
      observedState: "ready",
    });
    expect(response.body).not.toHaveProperty("token");
    expect(response.body).not.toHaveProperty("signature");
    expect(dependencies.acceptRunnerMessage).toHaveBeenCalledWith({
      sessionId,
      token,
    });
  });

  it("rejects malformed Runner messages before calling the acceptance store", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post(
        "/internal/preview-sessions/923e4567-e89b-42d3-a456-426614174003/runner-message",
      )
      .send({
        token: "opaque.signed-runner-message",
        runnerNodeId: node.nodeId,
      });

    expect(response.status).toBe(400);
    expect(dependencies.acceptRunnerMessage).not.toHaveBeenCalled();
  });

  it("requires TLS without cookies and maps stale Runner bindings safely", async () => {
    const { app, dependencies } = createApp({ production: true });
    const path =
      "/internal/preview-sessions/923e4567-e89b-42d3-a456-426614174003/runner-message";
    const body = { token: "opaque.signed-runner-message" };
    const cookieResponse = await request(app)
      .post(path)
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app).post(path).send(body);
    vi.mocked(dependencies.acceptRunnerMessage).mockRejectedValueOnce(
      new PreviewRunnerMessageAcceptanceError(
        "PREVIEW_RUNNER_MESSAGE_CONFLICT",
      ),
    );
    const staleResponse = await request(app)
      .post(path)
      .set("x-forwarded-proto", "https")
      .send(body);

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(staleResponse.status).toBe(409);
    expect(staleResponse.body).toEqual({
      error: "preview_runner_message_stale",
    });
    expect(dependencies.acceptRunnerMessage).toHaveBeenCalledTimes(1);
  });

  it("accepts an owner receipt and returns no signed command or receipt", async () => {
    const { app, dependencies } = createApp();
    const commandToken = "signed-command-token";
    const receiptToken = "owner-signed-receipt-token";
    const response = await request(app)
      .post(
        "/internal/preview-build-jobs/123e4567-e89b-42d3-a456-426614174000/artifact-store-receipt",
      )
      .send({ commandToken, receiptToken });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      stateVersion: 4,
      inputArtifactReady: true,
      alreadyAccepted: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(commandToken);
    expect(JSON.stringify(response.body)).not.toContain(receiptToken);
    expect(dependencies.acceptArtifactStoreReceipt).toHaveBeenCalledWith({
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      commandToken,
      receiptToken,
      buildJobPrivateKeyPem: commandSigningKeys.privateKey,
    });
  });

  it("issues a short-lived command only through a signed Agent poll", async () => {
    const { app, dependencies } = createApp();
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const proof = {
      version: 1,
      action: "poll-artifact-store-command",
      nodeId: node.nodeId,
      keyVersion: node.keyVersion,
      jobId,
      issuedAt: "2031-03-04T12:00:00.000Z",
      nonce: "323e4567-e89b-42d3-a456-426614174002",
    };
    const signature = "s".repeat(86);
    const response = await request(app)
      .post(`/internal/preview-build-jobs/${jobId}/artifact-store-command`)
      .send({ proof, signature });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      commandId: "223e4567-e89b-42d3-a456-426614174001",
      commandFingerprint: "a".repeat(64),
      expiresAt: "2031-03-04T12:00:30.000Z",
      commandToken: `signed-command-for-${jobId}`,
    });
    expect(dependencies.issueArtifactStoreCommand).toHaveBeenCalledWith({
      jobId,
      proof,
      signature,
      buildJobPrivateKeyPem: commandSigningKeys.privateKey,
    });
  });

  it("rejects Agent poll cookies/plaintext and returns a safe conflict", async () => {
    const { app, dependencies } = createApp({ production: true });
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const path = `/internal/preview-build-jobs/${jobId}/artifact-store-command`;
    const body = {
      proof: {
        version: 1,
        action: "poll-artifact-store-command",
        nodeId: node.nodeId,
        keyVersion: node.keyVersion,
        jobId,
        issuedAt: "2031-03-04T12:00:00.000Z",
        nonce: "323e4567-e89b-42d3-a456-426614174002",
      },
      signature: "s".repeat(86),
    };
    const cookieResponse = await request(app)
      .post(path)
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app).post(path).send(body);

    vi.mocked(dependencies.issueArtifactStoreCommand).mockRejectedValueOnce(
      new PreviewArtifactStoreCommandIssueError(
        "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT",
      ),
    );
    const conflictResponse = await request(app)
      .post(path)
      .set("x-forwarded-proto", "https")
      .send(body);

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body).toEqual({
      error: "preview_artifact_command_conflict",
    });
  });

  it("rejects extra receipt fields before reaching the acceptance service", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post(
        "/internal/preview-build-jobs/123e4567-e89b-42d3-a456-426614174000/artifact-store-receipt",
      )
      .send({
        commandToken: "signed-command-token",
        receiptToken: "owner-signed-receipt-token",
        ownerId: "caller-selected",
      });

    expect(response.status).toBe(400);
    expect(dependencies.acceptArtifactStoreReceipt).not.toHaveBeenCalled();
  });

  it("requires HTTPS without cookies and maps owner conflicts safely", async () => {
    const { app, dependencies } = createApp({ production: true });
    const path =
      "/internal/preview-build-jobs/123e4567-e89b-42d3-a456-426614174000/artifact-store-receipt";
    const body = {
      commandToken: "signed-command-token",
      receiptToken: "owner-signed-receipt-token",
    };
    const cookieResponse = await request(app)
      .post(path)
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app).post(path).send(body);

    vi.mocked(dependencies.acceptArtifactStoreReceipt).mockRejectedValueOnce(
      new PreviewArtifactStoreAcceptanceError(
        "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT",
      ),
    );
    const conflictResponse = await request(app)
      .post(path)
      .set("x-forwarded-proto", "https")
      .send(body);

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body).toEqual({
      error: "preview_artifact_receipt_conflict",
    });
  });

  it("requires a signed owner proof and returns no command while GC grace is pending", async () => {
    const { app, dependencies } = createApp();
    const path =
      "/internal/preview-build-jobs/123e4567-e89b-42d3-a456-426614174000/artifact-delete-command";
    const body = {
      proof: {
        version: 2,
        action: "poll-artifact-delete-command",
        nodeId: node.nodeId,
        keyVersion: 1,
        jobId: "123e4567-e89b-42d3-a456-426614174000",
        issuedAt: "2031-03-04T12:00:00.000Z",
        nonce: "923e4567-e89b-42d3-a456-426614174003",
      },
      signature: "s".repeat(86),
    };
    vi.mocked(dependencies.issueArtifactDeleteCommand).mockResolvedValueOnce(
      null,
    );
    const pending = await request(app).post(path).send(body);
    const issued = await request(app)
      .post(path)
      .send({ ...body, proof: { ...body.proof, nonce: "923e4567-e89b-42d3-a456-426614174004" } });

    expect(pending.status).toBe(204);
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({
      commandId: "323e4567-e89b-42d3-a456-426614174002",
      commandToken:
        "signed-delete-command-for-123e4567-e89b-42d3-a456-426614174000",
    });
    expect(dependencies.issueArtifactDeleteCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "123e4567-e89b-42d3-a456-426614174000",
        proof: body.proof,
        signature: body.signature,
      }),
    );
    expect(issued.headers["cache-control"]).toBe("no-store");
  });

  it("rejects cookie/HTTP delete polling and maps lease conflicts", async () => {
    const { app, dependencies } = createApp({ production: true });
    const path =
      "/internal/preview-build-jobs/123e4567-e89b-42d3-a456-426614174000/artifact-delete-command";
    const body = {
      proof: {
        version: 2,
        action: "poll-artifact-delete-command",
        nodeId: node.nodeId,
        keyVersion: 1,
        jobId: "123e4567-e89b-42d3-a456-426614174000",
        issuedAt: "2031-03-04T12:00:00.000Z",
        nonce: "923e4567-e89b-42d3-a456-426614174005",
      },
      signature: "s".repeat(86),
    };
    const cookieResponse = await request(app)
      .post(path)
      .set("Cookie", "session=unexpected")
      .set("x-forwarded-proto", "https")
      .send(body);
    const plaintextResponse = await request(app).post(path).send(body);
    vi.mocked(dependencies.issueArtifactDeleteCommand).mockRejectedValueOnce(
      new PreviewArtifactGcCommandIssueError(
        "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
      ),
    );
    const conflictResponse = await request(app)
      .post(path)
      .set("x-forwarded-proto", "https")
      .send(body);

    expect(cookieResponse.status).toBe(403);
    expect(plaintextResponse.status).toBe(403);
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body).toEqual({
      error: "preview_artifact_delete_command_conflict",
    });
  });

  it("accepts signed delete receipts without returning command tokens", async () => {
    const { app, dependencies } = createApp();
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const response = await request(app)
      .post(`/internal/preview-build-jobs/${jobId}/artifact-delete-receipt`)
      .send({
        commandToken: "server-signed-command",
        receiptToken: "agent-signed-receipt",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jobId,
      stateVersion: 6,
      artifactDeleted: true,
      alreadyAccepted: false,
    });
    expect(response.body).not.toHaveProperty("commandToken");
    expect(dependencies.acceptArtifactDeleteReceipt).toHaveBeenCalledWith({
      jobId,
      commandToken: "server-signed-command",
      receiptToken: "agent-signed-receipt",
      buildJobPrivateKeyPem: commandSigningKeys.privateKey,
    });
  });

  it("rejects additional delete receipt fields and safely maps conflicts", async () => {
    const { app, dependencies } = createApp();
    const path =
      "/internal/preview-build-jobs/123e4567-e89b-42d3-a456-426614174000/artifact-delete-receipt";
    const invalid = await request(app).post(path).send({
      commandToken: "server-signed-command",
      receiptToken: "agent-signed-receipt",
      artifactKey: "/caller/path",
    });
    vi.mocked(dependencies.acceptArtifactDeleteReceipt).mockRejectedValueOnce(
      new PreviewArtifactGcAcceptanceError(
        "PREVIEW_ARTIFACT_GC_ACCEPTANCE_CONFLICT",
      ),
    );
    const conflict = await request(app).post(path).send({
      commandToken: "server-signed-command",
      receiptToken: "agent-signed-receipt",
    });

    expect(invalid.status).toBe(400);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({
      error: "preview_artifact_delete_receipt_conflict",
    });
    expect(dependencies.acceptArtifactDeleteReceipt).toHaveBeenCalledTimes(1);
  });

  it("lists safe node summaries and scopes revocation to the owned project", async () => {
    const { app, dependencies } = createApp();
    const list = await request(app).get("/projects/project-1/preview-agents");
    const revoke = await request(app).post(
      `/projects/project-1/preview-agents/${node.nodeId}/revoke`,
    );

    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({
      nodeId: node.nodeId,
      storeId: node.storeId,
      status: "active",
    });
    expect(list.body[0]).not.toHaveProperty("publicKeyPem");
    expect(dependencies.listNodes).toHaveBeenCalledWith({
      projectId: "project-1",
    });
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({
      nodeId: node.nodeId,
      status: "revoked",
    });
    expect(dependencies.revokeNode).toHaveBeenCalledWith({
      projectId: "project-1",
      nodeId: node.nodeId,
    });
  });
});

describe("Preview Runner command polling route", () => {
  beforeEach(() => vi.clearAllMocks());

  const nodeId = pairing.nodeId;
  const sessionId = "523e4567-e89b-42d3-a456-426614174004";
  const proof = {
    version: 1 as const,
    action: "poll-preview-session-command" as const,
    nodeId,
    keyVersion: 1,
    sessionId,
    leaseOwner: "623e4567-e89b-42d3-a456-426614174005",
    issuedAt: "2031-03-04T12:00:00.000Z",
    nonce: "723e4567-e89b-42d3-a456-426614174006",
  };
  const path = `/internal/preview-agents/${nodeId}/preview-sessions/${sessionId}/command`;

  it("returns only the short-lived signed command envelope", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post(path)
      .send({ proof, signature: "A".repeat(86) });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      commandId: "423e4567-e89b-42d3-a456-426614174003",
      fencingGeneration: 4,
      expiresAt: "2031-03-04T12:00:30.000Z",
      commandToken: "short-lived.signed-command",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(dependencies.issueRunnerCommand).toHaveBeenCalledWith({
      nodeId,
      sessionId,
      proof,
      signature: "A".repeat(86),
      commandPrivateKeyPem: runnerCommandSigningKeys.privateKey,
    });
  });

  it("rejects route/body identity mismatches before reaching the issuer", async () => {
    const { app, dependencies } = createApp();
    const response = await request(app)
      .post(path)
      .send({
        proof: {
          ...proof,
          sessionId: "823e4567-e89b-42d3-a456-426614174007",
        },
        signature: "A".repeat(86),
      });

    expect(response.status).toBe(400);
    expect(dependencies.issueRunnerCommand).not.toHaveBeenCalled();
  });

  it("does not issue commands to browser-cookie or plaintext callers", async () => {
    const { app, dependencies } = createApp({ production: true });
    const cookieResponse = await request(app)
      .post(path)
      .set("Cookie", "session=unexpected")
      .send({ proof, signature: "A".repeat(86) });
    const insecureResponse = await request(app)
      .post(path)
      .send({ proof, signature: "A".repeat(86) });

    expect(cookieResponse.status).toBe(403);
    expect(insecureResponse.status).toBe(403);
    expect(dependencies.issueRunnerCommand).not.toHaveBeenCalled();
  });

  it("keeps unqualified runtimes closed", async () => {
    const { app, dependencies } = createApp();
    vi.mocked(dependencies.issueRunnerCommand).mockRejectedValueOnce(
      new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_UNQUALIFIED",
      ),
    );
    const response = await request(app)
      .post(path)
      .send({ proof, signature: "A".repeat(86) });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "preview_runner_unqualified" });
  });
});
