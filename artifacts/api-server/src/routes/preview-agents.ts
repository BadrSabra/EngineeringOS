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
  acceptPreviewAgentCapabilityReport,
  PreviewAgentCapabilityError,
} from "../lib/preview-agent-capability.js";
import {
  acceptPreviewBuildInputStoreReceipt,
  PreviewArtifactStoreAcceptanceError,
} from "../lib/preview-artifact-store-acceptance.js";
import {
  issuePreviewBuildInputStoreCommand,
  PreviewArtifactStoreCommandIssueError,
} from "../lib/preview-artifact-store-issuer.js";
import {
  acceptPreviewAgentHeartbeat,
  issuePreviewAgentHeartbeatChallenge,
  PreviewAgentHeartbeatError,
} from "../lib/preview-agent-heartbeat.js";
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

const capabilityReportSchema = z
  .object({
    qualificationRecordId: z.string().uuid(),
    token: z.string().min(1).max(8_192),
  })
  .strict();

const artifactStoreReceiptSchema = z
  .object({
    commandToken: z.string().min(1).max(8_192),
    receiptToken: z.string().min(1).max(8_192),
  })
  .strict();

const artifactStorePollProofSchema = z
  .object({
    proof: z
      .object({
        version: z.literal(1),
        action: z.literal("poll-artifact-store-command"),
        nodeId: z.string().uuid(),
        keyVersion: z.number().int().positive().max(1_000_000),
        jobId: z.string().uuid(),
        issuedAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        nonce: z.string().uuid(),
      })
      .strict(),
    signature: z.string().length(86),
  })
  .strict();

const previewAgentHeartbeatProofSchema = z
  .object({
    version: z.literal(1),
    action: z.literal("preview-agent-heartbeat"),
    nodeId: z.string().uuid(),
    keyVersion: z.number().int().positive().max(1_000_000),
    sequence: z.number().int().positive().max(2_147_483_647),
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

const previewAgentHeartbeatChallengeRequestProofSchema = z
  .object({
    version: z.literal(1),
    action: z.literal("request-preview-agent-heartbeat-challenge"),
    nodeId: z.string().uuid(),
    keyVersion: z.number().int().positive().max(1_000_000),
    sequence: z.number().int().positive().max(2_147_483_647),
    nonce: z.string().uuid(),
  })
  .strict();

const previewAgentHeartbeatChallengeRequestSchema = z
  .object({
    proof: previewAgentHeartbeatChallengeRequestProofSchema,
    signature: z.string().length(86).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const previewAgentHeartbeatSchema = z
  .object({
    proof: previewAgentHeartbeatProofSchema,
    signature: z.string().length(86).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

type PreviewAgentRouterDependencies = {
  requireAuth: RequestHandler;
  requireProjectAccess: RequestHandler;
  requireProjectWriteAccess: RequestHandler;
  createPairing: typeof createPreviewAgentPairing;
  completePairing: typeof completePreviewAgentPairing;
  submitCapabilityReport: typeof acceptPreviewAgentCapabilityReport;
  acceptArtifactStoreReceipt: typeof acceptPreviewBuildInputStoreReceipt;
  issueArtifactStoreCommand: typeof issuePreviewBuildInputStoreCommand;
  issueHeartbeatChallenge: typeof issuePreviewAgentHeartbeatChallenge;
  acceptHeartbeat: typeof acceptPreviewAgentHeartbeat;
  buildJobPrivateKeyPem: string | undefined;
  listNodes: typeof listPreviewAgentNodes;
  revokeNode: typeof revokePreviewAgentNode;
  isProduction: boolean;
  completionRateLimiter: RequestHandler;
  capabilityRateLimiter: RequestHandler;
};

const defaultDependencies: PreviewAgentRouterDependencies = {
  requireAuth,
  requireProjectAccess,
  requireProjectWriteAccess,
  createPairing: createPreviewAgentPairing,
  completePairing: completePreviewAgentPairing,
  submitCapabilityReport: acceptPreviewAgentCapabilityReport,
  acceptArtifactStoreReceipt: acceptPreviewBuildInputStoreReceipt,
  issueArtifactStoreCommand: issuePreviewBuildInputStoreCommand,
  issueHeartbeatChallenge: issuePreviewAgentHeartbeatChallenge,
  acceptHeartbeat: acceptPreviewAgentHeartbeat,
  buildJobPrivateKeyPem: config.previewBuildJobPrivateKeyPem,
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
  capabilityRateLimiter: rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "preview_agent_capability_temporarily_limited" },
  }),
};

function singleRouteParam(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sendNodes(
  response: Parameters<RequestHandler>[1],
  nodes: PreviewAgentNodeSummary[],
) {
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

function capabilityReportCode(error: unknown): string {
  if (error instanceof PreviewAgentCapabilityError) {
    switch (error.code) {
      case "PREVIEW_AGENT_CAPABILITY_UNQUALIFIED":
        return "preview_agent_capability_unsupported";
      case "PREVIEW_AGENT_CAPABILITY_UNAVAILABLE":
        return "preview_agent_capability_temporarily_unavailable";
      case "PREVIEW_AGENT_CAPABILITY_INVALID":
        return "preview_agent_capability_invalid";
    }
  }
  return "preview_agent_capability_temporarily_unavailable";
}

function artifactStoreReceiptCode(error: unknown): {
  status: number;
  error: string;
} {
  if (error instanceof PreviewArtifactStoreAcceptanceError) {
    switch (error.code) {
      case "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_INVALID":
        return { status: 403, error: "preview_artifact_receipt_rejected" };
      case "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT":
        return { status: 409, error: "preview_artifact_receipt_conflict" };
      case "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_UNAVAILABLE":
        return { status: 503, error: "preview_artifact_receipt_unavailable" };
    }
  }
  return { status: 503, error: "preview_artifact_receipt_unavailable" };
}

function artifactStoreCommandIssueCode(error: unknown): {
  status: number;
  error: string;
} {
  if (error instanceof PreviewArtifactStoreCommandIssueError) {
    switch (error.code) {
      case "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_INVALID":
        return { status: 403, error: "preview_artifact_command_rejected" };
      case "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT":
        return { status: 409, error: "preview_artifact_command_conflict" };
      case "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_UNAVAILABLE":
        return { status: 503, error: "preview_artifact_command_unavailable" };
    }
  }
  return { status: 503, error: "preview_artifact_command_unavailable" };
}

function heartbeatIssueCode(error: unknown): {
  status: number;
  error: string;
} {
  if (error instanceof PreviewAgentHeartbeatError) {
    switch (error.code) {
      case "PREVIEW_AGENT_HEARTBEAT_INVALID":
        return { status: 403, error: "preview_agent_heartbeat_rejected" };
      case "PREVIEW_AGENT_HEARTBEAT_CHALLENGE_PENDING":
        return { status: 409, error: "preview_agent_heartbeat_challenge_pending" };
      case "PREVIEW_AGENT_HEARTBEAT_REPLAY":
        return { status: 409, error: "preview_agent_heartbeat_replayed" };
      case "PREVIEW_AGENT_HEARTBEAT_UNAVAILABLE":
        return { status: 503, error: "preview_agent_heartbeat_unavailable" };
    }
  }
  return { status: 503, error: "preview_agent_heartbeat_unavailable" };
}

export function createPreviewAgentRouter(
  overrides: Partial<PreviewAgentRouterDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const router = Router();

  router.post(
    "/internal/preview-agents/:nodeId/heartbeat-challenge",
    dependencies.capabilityRateLimiter,
    async (request, response): Promise<void> => {
      response.setHeader("cache-control", "no-store");
      const nodeId = singleRouteParam(request.params.nodeId);
      if (
        request.get("cookie") ||
        (dependencies.isProduction && !request.secure)
      ) {
        response.status(403).json({ error: "preview_agent_heartbeat_rejected" });
        return;
      }
      const parsed = previewAgentHeartbeatChallengeRequestSchema.safeParse(
        request.body,
      );
      if (
        !parsed.success ||
        !nodeId ||
        !z.string().uuid().safeParse(nodeId).success ||
        parsed.data.proof.nodeId !== nodeId
      ) {
        response.status(400).json({ error: "invalid_preview_agent_heartbeat" });
        return;
      }
      try {
        const challenge = await dependencies.issueHeartbeatChallenge(
          parsed.data,
        );
        response.status(200).json({
          nodeId: challenge.nodeId,
          keyVersion: challenge.keyVersion,
          challenge: challenge.challenge,
          expiresAt: challenge.expiresAt,
        });
      } catch (error) {
        const mapped = heartbeatIssueCode(error);
        response.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  router.post(
    "/internal/preview-agents/:nodeId/heartbeat",
    dependencies.capabilityRateLimiter,
    async (request, response): Promise<void> => {
      response.setHeader("cache-control", "no-store");
      const nodeId = singleRouteParam(request.params.nodeId);
      if (
        request.get("cookie") ||
        (dependencies.isProduction && !request.secure)
      ) {
        response.status(403).json({ error: "preview_agent_heartbeat_rejected" });
        return;
      }
      const parsed = previewAgentHeartbeatSchema.safeParse(request.body);
      if (
        !parsed.success ||
        !nodeId ||
        !z.string().uuid().safeParse(nodeId).success ||
        parsed.data.proof.nodeId !== nodeId
      ) {
        response.status(400).json({ error: "invalid_preview_agent_heartbeat" });
        return;
      }
      try {
        const heartbeat = await dependencies.acceptHeartbeat(parsed.data);
        response.status(200).json({
          nodeId: heartbeat.nodeId,
          sequence: heartbeat.sequence,
          lastSeenAt: heartbeat.lastSeenAt,
          alreadyAccepted: heartbeat.alreadyAccepted,
        });
      } catch (error) {
        const mapped = heartbeatIssueCode(error);
        response.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  router.post(
    "/internal/preview-build-jobs/:jobId/artifact-store-command",
    dependencies.capabilityRateLimiter,
    async (request, response) => {
      response.setHeader("cache-control", "no-store");
      if (
        request.get("cookie") ||
        (dependencies.isProduction && !request.secure)
      ) {
        response
          .status(403)
          .json({ error: "preview_artifact_command_rejected" });
        return;
      }
      const parsed = artifactStorePollProofSchema.safeParse(request.body);
      const jobId = singleRouteParam(request.params.jobId);
      if (
        !parsed.success ||
        !jobId ||
        !z.string().uuid().safeParse(jobId).success
      ) {
        response.status(400).json({ error: "invalid_preview_artifact_poll" });
        return;
      }
      try {
        const command = await dependencies.issueArtifactStoreCommand({
          jobId,
          proof: parsed.data.proof,
          signature: parsed.data.signature,
          buildJobPrivateKeyPem: dependencies.buildJobPrivateKeyPem,
        });
        response.status(200).json(command);
      } catch (error) {
        const mapped = artifactStoreCommandIssueCode(error);
        response.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

  router.post(
    "/internal/preview-build-jobs/:jobId/artifact-store-receipt",
    dependencies.capabilityRateLimiter,
    async (request, response) => {
      response.setHeader("cache-control", "no-store");
      if (
        request.get("cookie") ||
        (dependencies.isProduction && !request.secure)
      ) {
        response
          .status(403)
          .json({ error: "preview_artifact_receipt_rejected" });
        return;
      }
      const parsed = artifactStoreReceiptSchema.safeParse(request.body);
      const jobId = singleRouteParam(request.params.jobId);
      if (
        !parsed.success ||
        !jobId ||
        !z.string().uuid().safeParse(jobId).success
      ) {
        response
          .status(400)
          .json({ error: "invalid_preview_artifact_receipt" });
        return;
      }
      try {
        const result = await dependencies.acceptArtifactStoreReceipt({
          jobId,
          commandToken: parsed.data.commandToken,
          receiptToken: parsed.data.receiptToken,
          buildJobPrivateKeyPem: dependencies.buildJobPrivateKeyPem,
        });
        response.status(200).json({
          jobId: result.job.jobId,
          stateVersion: result.job.stateVersion,
          inputArtifactReady: Boolean(result.job.inputArtifactReadyAt),
          alreadyAccepted: result.alreadyAccepted,
        });
      } catch (error) {
        const mapped = artifactStoreReceiptCode(error);
        response.status(mapped.status).json({ error: mapped.error });
      }
    },
  );

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

  router.post(
    "/preview-agent-capabilities/:nodeId/report",
    dependencies.capabilityRateLimiter,
    async (request, response): Promise<void> => {
      response.setHeader("cache-control", "no-store");
      if (
        request.get("cookie") ||
        (dependencies.isProduction && !request.secure)
      ) {
        response.status(403).json({
          error: "preview_agent_capability_invalid",
        });
        return;
      }
      const parsed = capabilityReportSchema.safeParse(request.body);
      const nodeId = singleRouteParam(request.params.nodeId);
      if (
        !parsed.success ||
        !nodeId ||
        !z.string().uuid().safeParse(nodeId).success
      ) {
        response.status(400).json({
          error: "preview_agent_capability_invalid",
        });
        return;
      }
      try {
        const report = await dependencies.submitCapabilityReport({
          nodeId,
          qualificationRecordId: parsed.data.qualificationRecordId,
          token: parsed.data.token,
        });
        response.status(200).json({
          nodeId: report.nodeId,
          accepted: true,
          expiresAt: report.expiresAt,
        });
      } catch (error) {
        const code = capabilityReportCode(error);
        response
          .status(
            code === "preview_agent_capability_unsupported"
              ? 409
              : code === "preview_agent_capability_temporarily_unavailable"
                ? 503
                : 400,
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
