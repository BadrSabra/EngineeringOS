import type { PreviewBuildJob } from "@workspace/db";
import type { PreviewBuildInputArchive } from "./preview-build-input.js";
import type { PreviewBuildInputIdentity } from "./preview-build-input.js";
import type { PreviewBuildJobClaims } from "./preview-build-job.js";

export type PreviewBuildExecution = {
  jobId: string;
  buildId: string;
  executionRef: string;
};

export type PreviewBuildObservation = {
  jobId: string;
  buildId: string;
  state: "not_found" | "pending" | "running" | "stopped" | "unknown";
  executionRef?: string;
  exitCode?: number;
  outputDigest?: string;
};

export type PreviewBuildAttestorResponse =
  | { jobId: string; buildId: string; state: "pending" }
  | { jobId: string; buildId: string; state: "failed" }
  | {
      jobId: string;
      buildId: string;
      state: "ready";
      receiptToken: string;
    };

export type PreviewBuildInputArtifactReceipt = {
  jobId: string;
  artifactRefId: string;
  sourceDigest: string;
  archiveDigest: string;
  objectKey: string;
};

/**
 * Stores the exact, already-validated source archive for a build. The provider
 * chooses its physical transport; the orchestration layer only verifies the
 * returned logical artifact identity and content digests.
 */
export interface PreviewBuildInputArtifactStore {
  storeInput(input: {
    jobId: string;
    identity: PreviewBuildInputIdentity;
    buildInput: PreviewBuildInputArchive;
    now: Date;
  }): Promise<PreviewBuildInputArtifactReceipt>;
}

/**
 * Provider-neutral boundary for starting and observing a Preview build.
 * Implementations must return an opaque executionRef; proof acceptance remains
 * owned by the API and is not delegated to the execution provider.
 */
export interface PreviewBuildExecutor {
  launch(input: {
    claims: PreviewBuildJobClaims;
    now: Date;
  }): Promise<PreviewBuildExecution>;
  observe(input: {
    job: PreviewBuildJob;
    now: Date;
  }): Promise<PreviewBuildObservation>;
}

/**
 * Requests an independent Attestor result for a specific durable build and
 * opaque execution reference. The caller still verifies the receipt server-side.
 */
export interface PreviewAttestationService {
  attest(input: {
    job: PreviewBuildJob;
    executionRef: string;
    now: Date;
  }): Promise<PreviewBuildAttestorResponse>;
}

export interface PreviewReceiptVerifier {
  verifyAndAccept(input: {
    jobId: string;
    token: string;
    publicKeyPem: string;
    expectedLeaseOwner?: string;
    now: () => Date;
  }): Promise<{
    job: PreviewBuildJob;
    alreadyVerified: boolean;
  }>;
}
