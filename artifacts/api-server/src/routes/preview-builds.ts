import { and, eq } from "drizzle-orm";
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod/v4";
import {
  aiChangeProposalsTable,
  db,
  type PreviewBuildJob,
} from "@workspace/db";
import { config } from "../config.js";
import {
  PreviewBuildJobStoreError,
  findPreviewBuildJobForOwner,
} from "../lib/preview-build-job-store.js";
import {
  PreviewBuildStartError,
  startOrResumePreviewBuild,
  type PreviewBuildCandidate,
  type PreviewBuildServiceConfig,
} from "../lib/preview-build-start.js";
import {
  requireProjectAccess,
  requireProjectWriteAccess,
} from "../middlewares/requireProjectAccess.js";

const startRequestSchema = z
  .object({
    clientRequestId: z.string().uuid(),
  })
  .strict();

function sendBuildJob(
  response: Response,
  job: PreviewBuildJob,
  launchPending = false,
): void {
  response.setHeader("cache-control", "no-store");
  response.json({
    jobId: job.jobId,
    buildId: job.buildId,
    status: job.status,
    stateVersion: job.stateVersion,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.failureCode ? { failureCode: job.failureCode } : {}),
    ...(launchPending ? { launchPending: true } : {}),
  });
}

function candidateErrorStatus(code: string): number {
  switch (code) {
    case "PREVIEW_BUILD_NOT_CONFIGURED":
    case "PREVIEW_BUILD_JOB_UNAVAILABLE":
      return 503;
    case "PREVIEW_BUILD_INPUT_REJECTED":
      return 422;
    case "PREVIEW_BUILD_CANDIDATE_STALE":
    case "PREVIEW_BUILD_IDEMPOTENCY_CONFLICT":
    case "PREVIEW_BUILD_ALREADY_ACTIVE":
      return 409;
    default:
      return 503;
  }
}

function safeBuildErrorCode(code: string): string {
  switch (code) {
    case "PREVIEW_BUILD_NOT_CONFIGURED":
      return "preview_builder_unavailable";
    case "PREVIEW_BUILD_INPUT_REJECTED":
      return "preview_build_input_rejected";
    case "PREVIEW_BUILD_CANDIDATE_STALE":
      return "preview_candidate_changed";
    case "PREVIEW_BUILD_IDEMPOTENCY_CONFLICT":
      return "preview_build_request_conflict";
    case "PREVIEW_BUILD_ALREADY_ACTIVE":
      return "preview_build_already_active";
    default:
      return "preview_build_temporarily_unavailable";
  }
}

type PreviewBuildRouterDependencies = {
  requireProjectAccess: RequestHandler;
  requireProjectWriteAccess: RequestHandler;
  loadCandidate(
    projectId: string,
    proposalId: string,
  ): Promise<PreviewBuildCandidate | null>;
  startBuild: typeof startOrResumePreviewBuild;
  findForOwner: typeof findPreviewBuildJobForOwner;
  serviceConfig: PreviewBuildServiceConfig;
};

const defaultDependencies: PreviewBuildRouterDependencies = {
  requireProjectAccess,
  requireProjectWriteAccess,
  async loadCandidate(projectId, proposalId) {
    const [proposal] = await db
      .select({
        id: aiChangeProposalsTable.id,
        projectId: aiChangeProposalsTable.projectId,
        operationId: aiChangeProposalsTable.operationId,
        status: aiChangeProposalsTable.status,
        lifecycle: aiChangeProposalsTable.lifecycle,
        revision: aiChangeProposalsTable.revision,
        candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
        changeSetHash: aiChangeProposalsTable.changeSetHash,
        workspaceRoot: aiChangeProposalsTable.workspaceRoot,
      })
      .from(aiChangeProposalsTable)
      .where(
        and(
          eq(aiChangeProposalsTable.id, proposalId),
          eq(aiChangeProposalsTable.projectId, projectId),
        ),
      )
      .limit(1);
    return proposal ?? null;
  },
  startBuild: startOrResumePreviewBuild,
  findForOwner: findPreviewBuildJobForOwner,
  serviceConfig: {
    gatewayUrl: config.previewGatewayUrl,
    buildInputUploadPrivateKeyPem: config.previewBuildInputUploadPrivateKeyPem,
    buildJobPrivateKeyPem: config.previewBuildJobPrivateKeyPem,
    builderImageDigest: config.previewBuilderImageDigest,
    sourceRoot: config.previewBuildSourceRoot,
  },
};

export function createPreviewBuildRouter(
  overrides: Partial<PreviewBuildRouterDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const router = Router();

  router.post(
    "/projects/:projectId/proposals/:proposalId/preview-builds",
    dependencies.requireProjectWriteAccess,
    async (req: Request, res: Response) => {
      const parsedBody = startRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: "invalid_preview_build_request" });
        return;
      }

      const projectId = req.params.projectId;
      const proposalId = req.params.proposalId;
      if (
        !projectId ||
        typeof projectId !== "string" ||
        !proposalId ||
        typeof proposalId !== "string" ||
        proposalId.length > 255 ||
        !req.userId
      ) {
        res.status(400).json({ error: "invalid_preview_build_request" });
        return;
      }

      let proposal: PreviewBuildCandidate | null;
      try {
        proposal = await dependencies.loadCandidate(projectId, proposalId);
      } catch {
        res.status(503).json({
          error: "preview_build_temporarily_unavailable",
        });
        return;
      }
      if (!proposal) {
        res.status(404).json({ error: "preview_candidate_not_found" });
        return;
      }

      try {
        const result = await dependencies.startBuild({
          candidate: proposal,
          projectId,
          userId: req.userId,
          clientRequestId: parsedBody.data.clientRequestId,
          config: dependencies.serviceConfig,
        });
        res.status(202);
        sendBuildJob(res, result.job, result.launchPending);
      } catch (error) {
        if (
          error instanceof PreviewBuildStartError ||
          error instanceof PreviewBuildJobStoreError
        ) {
          const code =
            error instanceof PreviewBuildStartError
              ? error.code
              : error.code === "PREVIEW_BUILD_JOB_IDEMPOTENCY_CONFLICT"
                ? "PREVIEW_BUILD_IDEMPOTENCY_CONFLICT"
                : "PREVIEW_BUILD_JOB_UNAVAILABLE";
          res.status(candidateErrorStatus(code)).json({
            error: safeBuildErrorCode(code),
          });
          return;
        }
        res.status(503).json({
          error: "preview_build_temporarily_unavailable",
        });
      }
    },
  );

  router.get(
    "/projects/:projectId/preview-builds/:jobId",
    dependencies.requireProjectAccess,
    async (req: Request, res: Response) => {
      const projectId = req.params.projectId;
      const jobId = req.params.jobId;
      if (
        !projectId ||
        typeof projectId !== "string" ||
        !jobId ||
        typeof jobId !== "string" ||
        !req.userId
      ) {
        res.status(400).json({ error: "invalid_preview_build_request" });
        return;
      }

      try {
        const job = await dependencies.findForOwner({
          jobId,
          projectId,
          userId: req.userId,
        });
        if (!job) {
          res.status(404).json({ error: "preview_build_not_found" });
          return;
        }
        sendBuildJob(res, job);
      } catch (error) {
        if (error instanceof PreviewBuildJobStoreError) {
          res.status(400).json({ error: "invalid_preview_build_request" });
          return;
        }
        res.status(503).json({
          error: "preview_build_temporarily_unavailable",
        });
      }
    },
  );

  return router;
}

export default createPreviewBuildRouter();
