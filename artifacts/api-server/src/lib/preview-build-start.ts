import type { PreviewBuildJob } from "@workspace/db";
import {
  createPreviewBuildInputArchive,
  isValidPreviewBuildSourceRoot,
  type PreviewBuildInputIdentity,
} from "./preview-build-input.js";
import type { PreviewBuildInputArchive } from "./preview-build-input.js";
import { uploadPreviewBuildInput } from "./preview-build-input-client.js";
import { previewBuildInputObjectKeyForArchive } from "./preview-build-upload.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";
import {
  assertPreviewBuildJobPrivateKeyPem,
  type PreviewBuildJobClaims,
} from "./preview-build-job.js";
import {
  createQueuedPreviewBuildJob,
  findActivePreviewBuildJob,
  findPreviewBuildJobByRequest,
  findPreviewBuildJobForOwner,
  markPreviewBuildInputReady,
  PreviewBuildJobStoreError,
  transitionPreviewBuildJob,
  type CreatePreviewBuildJobInput,
} from "./preview-build-job-store.js";
import { dispatchPreviewBuilderJob } from "./preview-builder-gateway-client.js";

const BUILD_JOB_TOKEN_TTL_MS = 5 * 60_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;

export type PreviewBuildCandidate = {
  id: string;
  projectId: string;
  operationId: string | null;
  status: string;
  lifecycle: string | null;
  revision: number;
  candidateTreeHash: string | null;
  changeSetHash: string | null;
  workspaceRoot: string | null;
};

export type PreviewBuildServiceConfig = {
  gatewayUrl: string | undefined;
  buildInputUploadPrivateKeyPem: string | undefined;
  buildJobPrivateKeyPem: string | undefined;
  builderImageDigest: string | undefined;
  sourceRoot: string | undefined;
};

export class PreviewBuildStartError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_NOT_CONFIGURED"
      | "PREVIEW_BUILD_CANDIDATE_STALE"
      | "PREVIEW_BUILD_INPUT_REJECTED"
      | "PREVIEW_BUILD_IDEMPOTENCY_CONFLICT"
      | "PREVIEW_BUILD_ALREADY_ACTIVE"
      | "PREVIEW_BUILD_JOB_UNAVAILABLE",
  ) {
    super("Preview build could not be started.");
    this.name = "PreviewBuildStartError";
  }
}

export type PreviewBuildStartResult = {
  job: PreviewBuildJob;
  launchPending: boolean;
};

type PreviewBuildStartDependencies = {
  now?: () => Date;
  createArchive?: typeof createPreviewBuildInputArchive;
  uploadInput?: typeof uploadPreviewBuildInput;
  findByRequest?: typeof findPreviewBuildJobByRequest;
  findActive?: typeof findActivePreviewBuildJob;
  findForOwner?: typeof findPreviewBuildJobForOwner;
  createJob?: typeof createQueuedPreviewBuildJob;
  markInputReady?: typeof markPreviewBuildInputReady;
  transitionJob?: typeof transitionPreviewBuildJob;
  dispatch?: typeof dispatchPreviewBuilderJob;
};

function candidateIdentity(
  candidate: PreviewBuildCandidate,
): PreviewBuildInputIdentity {
  if (
    candidate.status !== "pending" ||
    (candidate.lifecycle !== "isolated" &&
      candidate.lifecycle !== "validated") ||
    !candidate.operationId ||
    !candidate.workspaceRoot ||
    !candidate.candidateTreeHash ||
    !HASH_PATTERN.test(candidate.candidateTreeHash) ||
    !candidate.changeSetHash ||
    !HASH_PATTERN.test(candidate.changeSetHash) ||
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision < 0
  ) {
    throw new PreviewBuildStartError("PREVIEW_BUILD_CANDIDATE_STALE");
  }
  return {
    projectId: candidate.projectId,
    proposalId: candidate.id,
    operationId: candidate.operationId,
    proposalRevision: candidate.revision,
    candidateRevision: candidate.candidateTreeHash.toLowerCase(),
    changeSetHash: candidate.changeSetHash.toLowerCase(),
  };
}

function assertServiceConfig(
  config: PreviewBuildServiceConfig,
): asserts config is {
  gatewayUrl: string;
  buildInputUploadPrivateKeyPem: string;
  buildJobPrivateKeyPem: string;
  builderImageDigest: string;
  sourceRoot: string;
} {
  if (
    !config.gatewayUrl ||
    !config.buildInputUploadPrivateKeyPem ||
    !config.buildJobPrivateKeyPem ||
    !config.builderImageDigest ||
    !IMAGE_DIGEST_PATTERN.test(config.builderImageDigest) ||
    !config.sourceRoot ||
    !isValidPreviewBuildSourceRoot(config.sourceRoot)
  ) {
    throw new PreviewBuildStartError("PREVIEW_BUILD_NOT_CONFIGURED");
  }
  try {
    assertPreviewBuildJobPrivateKeyPem(config.buildJobPrivateKeyPem);
  } catch {
    throw new PreviewBuildStartError("PREVIEW_BUILD_NOT_CONFIGURED");
  }
}

function matchesCurrentCandidate(
  job: PreviewBuildJob,
  candidate: PreviewBuildCandidate,
  sourceRoot: string,
  builderImageDigest: string,
): boolean {
  return (
    job.projectId === candidate.projectId &&
    job.proposalId === candidate.id &&
    job.operationId === candidate.operationId &&
    job.proposalRevision === candidate.revision &&
    job.candidateRevision === candidate.candidateTreeHash?.toLowerCase() &&
    job.changeSetHash === candidate.changeSetHash?.toLowerCase() &&
    job.sourceRoot === sourceRoot &&
    job.builderImageDigest === builderImageDigest.toLowerCase()
  );
}

function claimsForJob(job: PreviewBuildJob): PreviewBuildJobClaims {
  return {
    version: 2,
    action: "preview-build",
    jobId: job.jobId,
    attemptId: job.jobId,
    idempotencyKey: job.clientRequestId,
    dispatchGeneration: job.dispatchGeneration,
    buildId: job.buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest: job.builderImageDigest,
    projectId: job.projectId,
    proposalId: job.proposalId,
    operationId: job.operationId,
    proposalRevision: job.proposalRevision,
    candidateRevision: job.candidateRevision,
    changeSetHash: job.changeSetHash,
    sourceRoot: job.sourceRoot,
    sourceDigest: job.sourceDigest,
    inputArtifactKey: job.inputArtifactKey,
    archiveDigest: job.archiveDigest,
    outputArtifactKey: job.outputArtifactKey,
    issuedAt: job.issuedAt.toISOString(),
    expiresAt: job.tokenExpiresAt.toISOString(),
  };
}

function jobIsWaitingForBuilder(job: PreviewBuildJob): boolean {
  return job.status === "queued" || job.status === "launching";
}

function isSafeStoreError(error: unknown): error is PreviewBuildJobStoreError {
  return error instanceof PreviewBuildJobStoreError;
}

export async function startOrResumePreviewBuild(input: {
  candidate: PreviewBuildCandidate;
  projectId: string;
  userId: string;
  clientRequestId: string;
  config: PreviewBuildServiceConfig;
  dependencies?: PreviewBuildStartDependencies;
}): Promise<PreviewBuildStartResult> {
  assertServiceConfig(input.config);
  const identity = candidateIdentity(input.candidate);
  if (
    input.projectId !== input.candidate.projectId ||
    !input.userId.trim() ||
    input.clientRequestId.length > 36
  ) {
    throw new PreviewBuildStartError("PREVIEW_BUILD_CANDIDATE_STALE");
  }

  const now = input.dependencies?.now ?? (() => new Date());
  const findByRequest =
    input.dependencies?.findByRequest ?? findPreviewBuildJobByRequest;
  const findActive =
    input.dependencies?.findActive ?? findActivePreviewBuildJob;
  const findForOwner =
    input.dependencies?.findForOwner ?? findPreviewBuildJobForOwner;
  const createArchive =
    input.dependencies?.createArchive ?? createPreviewBuildInputArchive;
  const uploadInput =
    input.dependencies?.uploadInput ?? uploadPreviewBuildInput;
  const createJob =
    input.dependencies?.createJob ?? createQueuedPreviewBuildJob;
  const markInputReady =
    input.dependencies?.markInputReady ?? markPreviewBuildInputReady;
  const transitionJob =
    input.dependencies?.transitionJob ?? transitionPreviewBuildJob;
  const dispatch = input.dependencies?.dispatch ?? dispatchPreviewBuilderJob;

  let job = await findByRequest({
    projectId: input.projectId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
  });

  let preparedBuildInput: PreviewBuildInputArchive | undefined;
  if (job) {
    if (
      !matchesCurrentCandidate(
        job,
        input.candidate,
        input.config.sourceRoot,
        input.config.builderImageDigest,
      )
    ) {
      throw new PreviewBuildStartError("PREVIEW_BUILD_IDEMPOTENCY_CONFLICT");
    }
  } else {
    const activeJob = await findActive({
      projectId: input.projectId,
      userId: input.userId,
      proposalId: identity.proposalId,
    });
    if (activeJob) {
      throw new PreviewBuildStartError("PREVIEW_BUILD_ALREADY_ACTIVE");
    }

    try {
      preparedBuildInput = await createArchive({
        workspaceRoot: input.candidate.workspaceRoot!,
        sourceRoot: input.config.sourceRoot,
        identity,
      });
    } catch {
      throw new PreviewBuildStartError("PREVIEW_BUILD_INPUT_REJECTED");
    }

    const issuedAt = now();
    const jobInput: CreatePreviewBuildJobInput = {
      clientRequestId: input.clientRequestId,
      projectId: input.projectId,
      userId: input.userId,
      proposalId: identity.proposalId,
      operationId: identity.operationId,
      proposalRevision: identity.proposalRevision,
      candidateRevision: identity.candidateRevision,
      changeSetHash: identity.changeSetHash,
      sourceRoot: input.config.sourceRoot,
      sourceDigest: preparedBuildInput.manifest.sourceDigest,
      archiveDigest: preparedBuildInput.archiveDigest,
      inputArtifactProvider: "s3",
      outputArtifactProvider: "s3",
      builderImageDigest: input.config.builderImageDigest,
      issuedAt,
      tokenExpiresAt: new Date(issuedAt.getTime() + BUILD_JOB_TOKEN_TTL_MS),
    };
    try {
      job = await createJob(jobInput, issuedAt);
    } catch (error) {
      if (isSafeStoreError(error)) {
        throw new PreviewBuildStartError(
          error.code === "PREVIEW_BUILD_JOB_IDEMPOTENCY_CONFLICT"
            ? "PREVIEW_BUILD_IDEMPOTENCY_CONFLICT"
            : error.code === "PREVIEW_BUILD_JOB_ALREADY_ACTIVE"
              ? "PREVIEW_BUILD_ALREADY_ACTIVE"
              : "PREVIEW_BUILD_JOB_UNAVAILABLE",
        );
      }
      throw new PreviewBuildStartError("PREVIEW_BUILD_JOB_UNAVAILABLE");
    }
    if (
      !job ||
      !matchesCurrentCandidate(
        job,
        input.candidate,
        input.config.sourceRoot,
        input.config.builderImageDigest,
      )
    ) {
      throw new PreviewBuildStartError("PREVIEW_BUILD_CANDIDATE_STALE");
    }
  }

  if (job.status !== "queued" && job.status !== "launching") {
    return { job, launchPending: false };
  }

  let currentTime = now();
  if (job.status === "queued") {
    if (job.tokenExpiresAt.getTime() <= currentTime.getTime()) {
      const expired = await transitionJob({
        jobId: job.jobId,
        expectedStatus: "queued",
        expectedVersion: job.stateVersion,
        nextStatus: "expired",
        now: currentTime,
      });
      if (expired) return { job: expired, launchPending: false };
      const current = await findForOwner({
        jobId: job.jobId,
        projectId: input.projectId,
        userId: input.userId,
      });
      const resolved = current ?? job;
      return { job: resolved, launchPending: jobIsWaitingForBuilder(resolved) };
    }

    if (!job.inputArtifactReadyAt) {
      let buildInput = preparedBuildInput;
      if (!buildInput) {
        try {
          buildInput = await createArchive({
            workspaceRoot: input.candidate.workspaceRoot!,
            sourceRoot: input.config.sourceRoot,
            identity,
          });
        } catch {
          throw new PreviewBuildStartError("PREVIEW_BUILD_INPUT_REJECTED");
        }
      }
      if (
        buildInput.manifest.sourceDigest !== job.sourceDigest ||
        buildInput.archiveDigest !== job.archiveDigest ||
        buildInput.totalBytes !== buildInput.archive.byteLength ||
        buildInput.manifest.sourceRoot !== job.sourceRoot
      ) {
        await transitionJob({
          jobId: job.jobId,
          expectedStatus: "queued",
          expectedVersion: job.stateVersion,
          nextStatus: "failed",
          failureCode: "PREVIEW_BUILD_INPUT_CHANGED",
          now: now(),
        });
        throw new PreviewBuildStartError("PREVIEW_BUILD_INPUT_REJECTED");
      }
      const expectedInputArtifactKey = previewBuildInputObjectKeyForArchive({
        identity,
        sourceDigest: buildInput.manifest.sourceDigest,
        archiveDigest: buildInput.archiveDigest,
      });
      let uploaded;
      try {
        uploaded = await uploadInput({
          gatewayUrl: input.config.gatewayUrl,
          privateKeyPem: input.config.buildInputUploadPrivateKeyPem,
          jobId: job.jobId,
          identity,
          buildInput,
          now: now(),
        });
      } catch {
        throw new PreviewBuildStartError("PREVIEW_BUILD_JOB_UNAVAILABLE");
      }
      if (
        uploaded.jobId !== job.jobId ||
        uploaded.artifactRefId !==
          previewBuildArtifactRefId(job.jobId, "input") ||
        uploaded.sourceDigest !== buildInput.manifest.sourceDigest ||
        uploaded.archiveDigest !== buildInput.archiveDigest ||
        uploaded.objectKey !== expectedInputArtifactKey ||
        uploaded.objectKey !== job.inputArtifactKey
      ) {
        await transitionJob({
          jobId: job.jobId,
          expectedStatus: "queued",
          expectedVersion: job.stateVersion,
          nextStatus: "failed",
          failureCode: "PREVIEW_BUILD_INPUT_REJECTED",
          now: now(),
        });
        throw new PreviewBuildStartError("PREVIEW_BUILD_INPUT_REJECTED");
      }
      const ready = await markInputReady({
        jobId: job.jobId,
        expectedVersion: job.stateVersion,
        inputArtifactKey: job.inputArtifactKey,
        archiveDigest: job.archiveDigest,
        now: now(),
      });
      if (ready) {
        job = ready;
      } else {
        const current = await findForOwner({
          jobId: job.jobId,
          projectId: input.projectId,
          userId: input.userId,
        });
        if (
          !current ||
          !current.inputArtifactReadyAt ||
          current.inputArtifactGcState !== "active"
        ) {
          throw new PreviewBuildStartError("PREVIEW_BUILD_JOB_UNAVAILABLE");
        }
        job = current;
      }
      currentTime = now();
      if (job.tokenExpiresAt.getTime() <= currentTime.getTime()) {
        const expired = await transitionJob({
          jobId: job.jobId,
          expectedStatus: "queued",
          expectedVersion: job.stateVersion,
          nextStatus: "expired",
          now: currentTime,
        });
        if (expired) return { job: expired, launchPending: false };
        const current = await findForOwner({
          jobId: job.jobId,
          projectId: input.projectId,
          userId: input.userId,
        });
        const resolved = current ?? job;
        return {
          job: resolved,
          launchPending: jobIsWaitingForBuilder(resolved),
        };
      }
    }

    const launching = await transitionJob({
      jobId: job.jobId,
      expectedStatus: "queued",
      expectedVersion: job.stateVersion,
      nextStatus: "launching",
      now: currentTime,
    });
    if (launching) {
      job = launching;
    } else {
      const current = await findForOwner({
        jobId: job.jobId,
        projectId: input.projectId,
        userId: input.userId,
      });
      if (!current || current.status !== "launching") {
        const resolved = current ?? job;
        return {
          job: resolved,
          launchPending: jobIsWaitingForBuilder(resolved),
        };
      }
      job = current;
    }
  }

  if (job.tokenExpiresAt.getTime() <= now().getTime()) {
    return { job, launchPending: true };
  }

  try {
    const launched = await dispatch({
      gatewayUrl: input.config.gatewayUrl,
      privateKeyPem: input.config.buildJobPrivateKeyPem,
      claims: claimsForJob(job),
      now: now(),
    });
    const running = await transitionJob({
      jobId: job.jobId,
      expectedStatus: "launching",
      expectedVersion: job.stateVersion,
      nextStatus: "running",
      executionRef: launched.executionRef,
      now: now(),
    });
    if (running) return { job: running, launchPending: false };
    const current = await findForOwner({
      jobId: job.jobId,
      projectId: input.projectId,
      userId: input.userId,
    });
    if (
      current?.status === "running" &&
      current.executionRef === launched.executionRef
    ) {
      return { job: current, launchPending: false };
    }
    const resolved = current ?? job;
    return { job: resolved, launchPending: jobIsWaitingForBuilder(resolved) };
  } catch {
    // A request timeout can happen after ECS accepted RunTask. Keep the
    // durable row in `launching` so a same-token retry can recover the same
    // ECS client token instead of issuing a second task.
    return { job, launchPending: true };
  }
}
