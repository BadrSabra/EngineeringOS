import express, { type RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PreviewAgentNodeSummary,
} from "../lib/preview-agent-pairing.js";
import { PreviewAgentCapabilityError } from "../lib/preview-agent-capability.js";
import { createPreviewAgentRouter } from "./preview-agents.js";

const pairing = {
  nodeId: "d69b66c5-9cb9-4c9a-ae60-1cc578c40700",
  storeId: "e3397306-4254-4a5c-a5e8-3a48968751dd",
  pairingCode: "A".repeat(43),
  expiresAt: new Date("2031-03-04T12:10:00.000Z"),
};

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
