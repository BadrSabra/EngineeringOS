import type { PreviewBuildJob } from "@workspace/db";
import {
  verifyPreviewBuildReceipt,
  type VerifiedPreviewBuildReceipt,
} from "./preview-build-receipt.js";
import {
  findPreviewBuildJobById,
  previewBuildJobMatchesVerifiedReceipt,
  transitionPreviewBuildJob,
} from "./preview-build-job-store.js";

export class PreviewBuildAttestationError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_ATTESTOR_NOT_CONFIGURED"
      | "PREVIEW_BUILD_ATTESTOR_INPUT_INVALID"
      | "PREVIEW_BUILD_ATTESTOR_JOB_NOT_READY"
      | "PREVIEW_BUILD_ATTESTOR_RECEIPT_REJECTED"
      | "PREVIEW_BUILD_ATTESTOR_CONFLICT"
      | "PREVIEW_BUILD_ATTESTOR_UNAVAILABLE",
  ) {
    super("Preview build attestation was rejected or is unavailable.");
    this.name = "PreviewBuildAttestationError";
  }
}

export type PreviewBuildAttestationResult = {
  job: PreviewBuildJob;
  alreadyVerified: boolean;
};

type PreviewBuildAttestorDependencies = {
  now?: () => Date;
  findJob?: typeof findPreviewBuildJobById;
  transition?: typeof transitionPreviewBuildJob;
};

export async function acceptPreviewBuildReceipt(input: {
  jobId: string;
  token: string;
  publicKeyPem: string | undefined;
  dependencies?: PreviewBuildAttestorDependencies;
}): Promise<PreviewBuildAttestationResult> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.jobId,
    ) ||
    typeof input.token !== "string" ||
    input.token.length < 1 ||
    input.token.length > 8_192
  ) {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_INPUT_INVALID",
    );
  }
  if (!input.publicKeyPem) {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_NOT_CONFIGURED",
    );
  }

  const now = input.dependencies?.now ?? (() => new Date());
  const findJob = input.dependencies?.findJob ?? findPreviewBuildJobById;
  const transition =
    input.dependencies?.transition ?? transitionPreviewBuildJob;

  let job: PreviewBuildJob | null;
  try {
    job = await findJob(input.jobId);
  } catch {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_UNAVAILABLE",
    );
  }
  if (!job) {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_JOB_NOT_READY",
    );
  }
  if (job.status === "verified" && job.buildReceiptId && job.outputDigest) {
    return { job, alreadyVerified: true };
  }
  if (
    job.status !== "builder_succeeded" ||
    !job.executionRef ||
    !job.outputDigest
  ) {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_JOB_NOT_READY",
    );
  }

  let receipt: VerifiedPreviewBuildReceipt;
  try {
    receipt = verifyPreviewBuildReceipt({
      token: input.token,
      publicKeyPem: input.publicKeyPem,
      expected: {
        identity: {
          projectId: job.projectId,
          proposalId: job.proposalId,
          operationId: job.operationId,
          proposalRevision: job.proposalRevision,
          candidateRevision: job.candidateRevision,
          changeSetHash: job.changeSetHash,
        },
        sourceDigest: job.sourceDigest,
        archiveDigest: job.archiveDigest,
        builderImageDigest: job.builderImageDigest,
        buildId: job.buildId,
        outputArtifactKey: job.outputArtifactKey,
        attemptId: job.jobId,
        idempotencyKey: job.clientRequestId,
        dispatchGeneration: job.dispatchGeneration,
      },
      now: now(),
    });
  } catch {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_RECEIPT_REJECTED",
    );
  }

  if (!previewBuildJobMatchesVerifiedReceipt(job, receipt)) {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_RECEIPT_REJECTED",
    );
  }

  let verified: PreviewBuildJob | null;
  try {
    verified = await transition({
      jobId: job.jobId,
      expectedStatus: "builder_succeeded",
      expectedVersion: job.stateVersion,
      nextStatus: "verified",
      executionRef: job.executionRef,
      verifiedReceipt: receipt,
      now: now(),
    });
  } catch {
    throw new PreviewBuildAttestationError(
      "PREVIEW_BUILD_ATTESTOR_RECEIPT_REJECTED",
    );
  }
  if (verified) return { job: verified, alreadyVerified: false };

  const current = await findJob(job.jobId);
  if (
    current?.status === "verified" &&
    current.buildReceiptId === receipt.receiptId &&
    current.outputDigest === receipt.buildOutputDigest
  ) {
    return { job: current, alreadyVerified: true };
  }
  throw new PreviewBuildAttestationError("PREVIEW_BUILD_ATTESTOR_CONFLICT");
}
