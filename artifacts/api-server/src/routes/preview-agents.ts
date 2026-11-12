import rateLimit from "express-rate-limit";
import { Router, type RequestHandler } from "express";
import { z } from "zod/v4";
import { config } from "../config.js";
import {
  completePreviewAgentPairing,
  createPreviewAgentPairing,
  listPreviewAgentNodes,
  PreviewAgentPairingError,
  revokePreviewAgentNode,
  type PreviewAgentNodeSummary,
} from "../lib/preview-agent-pairing.js";
import {
  requireProjectAccess,
  requireProjectWriteAccess,
} from "../middlewares/requireProjectAccess.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const createPairingSchema = z
  .object({
    storeId: z.string().uuid(),
  })
  .strict();

const completePairingSchema = z
  .object({
    pairingCode: z.string().length(43),
    storeId: z.string().uuid(),
    publicKeyPem: z.string().min(1).max(16_384),
    proof: z.string().length(86),
    agentVersion: z
      .string()
      .regex(/^[0-9][0-9A-Za-z.+-]{0,63}$/),
    platform: z.literal("linux"),
  })
  .strict();

type PreviewAgentRouterDependencies = {
  requireAuth: RequestHandler;
  requireProjectAccess: RequestHandler;
  requireProjectWriteAccess: RequestHandler;
  createPairing: typeof createPreviewAgentPairing;
  completePairing: typeof completePreviewAgentPairing;
  listNodes: typeof listPreviewAgentNodes;
  revokeNode: typeof revokePreviewAgentNode;
  isProduction: boolean;
  completionRateLimiter: RequestHandler;
};

const defaultDependencies: PreviewAgentRouterDependencies = {
  requireAuth,
  requireProjectAccess,
  requireProjectWriteAccess,
  createPairing: createPreviewAgentPairing,
  completePairing: completePreviewAgentPairing,
  listNodes: listPreviewAgentNodes,
  revokeNode: revokePreviewAgentNode,
  isProduction: config.isProduction,
  completionRateLimiter: rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "preview_agent_pairing_temporarily_limited" },
  }),
};

function singleRouteParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sendNodes(response: Parameters<RequestHandler>[1], nodes: PreviewAgentNodeSummary[]) {
  response.setHeader("cache-control", "no-store");
  response.json(
    nodes.map((node) => ({
      nodeId: node.nodeId,
      projectId: node.projectId,
      storeId: node.storeId,
      status: node.status,
      publicKeyFingerprint: node.publicKeyFingerprint,
      agentVersion: node.agentVersion,
      platform: node.platform,
      keyVersion: node.keyVersion,
      pairingExpiresAt: node.pairingExpiresAt,
      pairedAt: node.pairedAt,
      lastSeenAt: node.lastSeenAt,
      revokedAt: node.revokedAt,
      createdAt: node.createdAt,
    })),
  );
}

function unavailableCode(error: unknown): string {
  if (error instanceof PreviewAgentPairingError) {
    switch (error.code) {
      case "PREVIEW_AGENT_STORE_ALREADY_PAIRED":
        return "preview_agent_store_already_paired";
      case "PREVIEW_AGENT_KEY_ALREADY_REGISTERED":
        return "preview_agent_key_already_registered";
      case "PREVIEW_AGENT_PAIRING_CONFLICT":
        return "preview_agent_pairing_conflict";
      case "PREVIEW_AGENT_PAIRING_INVALID":
      case "PREVIEW_AGENT_PAIRING_EXPIRED":
      case "PREVIEW_AGENT_PAIRING_NOT_FOUND":
        return "preview_agent_pairing_invalid";
      case "PREVIEW_AGENT_PAIRING_UNAVAILABLE":
        return "preview_agent_pairing_temporarily_unavailable";
    }
  }
  return "preview_agent_pairing_temporarily_unavailable";
}

export function createPreviewAgentRouter(
  overrides: Partial<PreviewAgentRouterDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const router = Router();

  router.post(
    "/projects/:projectId/preview-agents/pairings",
    dependencies.requireAuth,
    dependencies.requireProjectWriteAccess,
    async (request, response) => {
      response.setHeader("cache-control", "no-store");
      const parsed = createPairingSchema.safeParse(request.body);
      const projectId = singleRouteParam(request.params.projectId);
      if (!parsed.success || !projectId || !request.userId) {
        response.status(400).json({ error: "invalid_preview_agent_pairing" });
        return;
      }
      try {
        const pairing = await dependencies.createPairing({
          projectId,
          userId: request.userId,
          storeId: parsed.data.storeId,
        });
        response.status(201).json({
          nodeId: pairing.nodeId,
          storeId: pairing.storeId,
          pairingCode: pairing.pairingCode,
          expiresAt: pairing.expiresAt,
        });
      } catch (error) {
        const code = unavailableCode(error);
        const status =
          code === "preview_agent_store_already_paired" ||
          code === "preview_agent_key_already_registered" ||
          code === "preview_agent_pairing_conflict"
            ? 409
            : code === "preview_agent_pairing_temporarily_unavailable"
              ? 503
              : 400;
        response.status(status).json({ error: code });
      }
    },
  );

  router.post(
    "/preview-agent-pairings/complete",
    dependencies.completionRateLimiter,
    async (request, response) => {
      response.setHeader("cache-control", "no-store");
      if (
        request.get("cookie") ||
        (dependencies.isProduction && !request.secure)
      ) {
        response.status(403).json({ error: "preview_agent_pairing_invalid" });
        return;
      }
      const parsed = completePairingSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "preview_agent_pairing_invalid" });
        return;
      }
      try {
        const node = await dependencies.completePairing(parsed.data);
        response.status(200).json({
          nodeId: node.nodeId,
          storeId: node.storeId,
          status: node.status,
          publicKeyFingerprint: node.publicKeyFingerprint,
          keyVersion: node.keyVersion,
          pairedAt: node.pairedAt,
        });
      } catch (error) {
        const code = unavailableCode(error);
        response
          .status(
            code === "preview_agent_pairing_temporarily_unavailable" ? 503 : 400,
          )
          .json({ error: code });
      }
    },
  );

  router.get(
    "/projects/:projectId/preview-agents",
    dependencies.requireAuth,
    dependencies.requireProjectAccess,
    async (request, response) => {
      response.setHeader("cache-control", "no-store");
      const projectId = singleRouteParam(request.params.projectId);
      if (!projectId || !request.userId) {
        response.status(400).json({ error: "invalid_preview_agent_request" });
        return;
      }
      try {
        sendNodes(
          response,
          await dependencies.listNodes({
            projectId,
          }),
        );
      } catch {
        response
          .status(503)
          .json({ error: "preview_agent_pairing_temporarily_unavailable" });
      }
    },
  );

  router.post(
    "/projects/:projectId/preview-agents/:nodeId/revoke",
    dependencies.requireAuth,
    dependencies.requireProjectWriteAccess,
    async (request, response) => {
      response.setHeader("cache-control", "no-store");
      const projectId = singleRouteParam(request.params.projectId);
      const nodeId = singleRouteParam(request.params.nodeId);
      if (!projectId || !nodeId || !request.userId) {
        response.status(400).json({ error: "invalid_preview_agent_request" });
        return;
      }
      try {
        const node = await dependencies.revokeNode({
          projectId,
          nodeId,
        });
        if (!node) {
          response.status(404).json({ error: "preview_agent_not_found" });
          return;
        }
        response.json({
          nodeId: node.nodeId,
          storeId: node.storeId,
          status: node.status,
          keyVersion: node.keyVersion,
          revokedAt: node.revokedAt,
        });
      } catch {
        response
          .status(503)
          .json({ error: "preview_agent_pairing_temporarily_unavailable" });
      }
    },
  );

  return router;
}

export default createPreviewAgentRouter();
