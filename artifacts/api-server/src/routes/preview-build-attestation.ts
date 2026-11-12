import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { config } from "../config.js";
import {
  acceptPreviewBuildReceipt,
  PreviewBuildAttestationError,
} from "../lib/preview-build-attestor.js";

const receiptBodySchema = z
  .object({
    token: z.string().min(1).max(8_192),
  })
  .strict();

function responseCode(code: string): {
  status: number;
  error: string;
} {
  switch (code) {
    case "PREVIEW_BUILD_ATTESTOR_NOT_CONFIGURED":
    case "PREVIEW_BUILD_ATTESTOR_UNAVAILABLE":
      return { status: 503, error: "preview_attestation_unavailable" };
    case "PREVIEW_BUILD_ATTESTOR_INPUT_INVALID":
      return { status: 400, error: "invalid_attestation_request" };
    case "PREVIEW_BUILD_ATTESTOR_JOB_NOT_READY":
      return { status: 409, error: "preview_build_not_ready_for_attestation" };
    case "PREVIEW_BUILD_ATTESTOR_CONFLICT":
      return { status: 409, error: "preview_attestation_conflict" };
    default:
      return { status: 403, error: "preview_attestation_rejected" };
  }
}

export function createPreviewBuildAttestationRouter(
  dependencies: {
    publicKeyPem: string | undefined;
    acceptReceipt?: typeof acceptPreviewBuildReceipt;
  } = { publicKeyPem: config.previewBuildReceiptPublicKeyPem },
) {
  const router = Router();
  const acceptReceipt = dependencies.acceptReceipt ?? acceptPreviewBuildReceipt;

  router.post(
    "/internal/preview-build-jobs/:jobId/receipt",
    async (req: Request, res: Response) => {
      const parsed = receiptBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .setHeader("cache-control", "no-store")
          .status(400)
          .json({ error: "invalid_attestation_request" });
        return;
      }
      const jobId = req.params.jobId;
      if (!jobId || typeof jobId !== "string") {
        res
          .setHeader("cache-control", "no-store")
          .status(400)
          .json({ error: "invalid_attestation_request" });
        return;
      }

      try {
        const result = await acceptReceipt({
          jobId,
          token: parsed.data.token,
          publicKeyPem: dependencies.publicKeyPem,
        });
        res.setHeader("cache-control", "no-store").status(200).json({
          jobId: result.job.jobId,
          buildId: result.job.buildId,
          status: result.job.status,
          stateVersion: result.job.stateVersion,
          alreadyVerified: result.alreadyVerified,
        });
      } catch (error) {
        const mapped =
          error instanceof PreviewBuildAttestationError
            ? responseCode(error.code)
            : {
                status: 503,
                error: "preview_attestation_unavailable",
              };
        res
          .setHeader("cache-control", "no-store")
          .status(mapped.status)
          .json({ error: mapped.error });
      }
    },
  );
  return router;
}

export default createPreviewBuildAttestationRouter();
