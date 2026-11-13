import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiChangeProposalsTable,
  db,
  previewBuildJobsTable,
  projectsTable,
  type PreviewBuildJob,
} from "@workspace/db";
import { z } from "zod/v4";
import { previewBuildInputObjectKeyForArchive } from "./preview-build-upload.js";
import {
  isVerifiedPreviewBuildReceipt,
  type VerifiedPreviewBuildReceipt,
} from "./preview-build-receipt.js";
import {
  assertPreviewBuildJobTransition,
  assertPreviewBuildJobTransitionData,
  type PreviewBuildJobStatus,
} from "./preview-build-job-state.js";
import { lockPreviewArtifactDigest } from "./preview-artifact-db-lock.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const MAX_JOB_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const MAX_SOURCE_ROOT_LENGTH = 512;

export class PreviewBuildJobStoreError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_JOB_INPUT_INVALID"
      | "PREVIEW_BUILD_JOB_IDEMPOTENCY_CONFLICT"
      | "PREVIEW_BUILD_JOB_ALREADY_ACTIVE"
      | "PREVIEW_BUILD_JOB_TRANSITION_INVALID"
      | "PREVIEW_BUILD_ARTIFACT_GC_IN_PROGRESS",
  ) {
    super("Preview build job request is invalid or no longer current.");
    this.name = "PreviewBuildJobStoreError";
  }
}

export type CreatePreviewBuildJobInput = {
  clientRequestId: string;
  projectId: string;
  userId: string;
  proposalId: string;
  operationId: string;
  proposalRevision: number;
  candidateRevision: string;
  changeSetHash: string;
  sourceRoot: string;
  sourceDigest: string;
  archiveDigest: string;
  inputArtifactProvider: "local" | "s3";
  outputArtifactProvider: "local" | "s3";
  builderImageDigest: string;
  issuedAt: Date;
  tokenExpiresAt: Date;
};

function validSourceRoot(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SOURCE_ROOT_LENGTH &&
    value === value.normalize("NFC") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    (value === "." ||
      value.split("/").every((part) => part && part !== "." && part !== ".."))
  );
}

function assertCreateInput(input: CreatePreviewBuildJobInput, now: Date): void {
  const parsed = z
    .object({
      clientRequestId: z.string().regex(UUID_PATTERN),
      projectId: z.string().min(1).max(255),
      userId: z.string().min(1).max(255),
      proposalId: z.string().min(1).max(255),
      operationId: z.string().min(1).max(255),
      proposalRevision: z.number().int().safe().nonnegative(),
      candidateRevision: z.string().regex(HASH_PATTERN),
      changeSetHash: z.string().regex(HASH_PATTERN),
      sourceRoot: z.string().min(1).max(MAX_SOURCE_ROOT_LENGTH),
      sourceDigest: z.string().regex(HASH_PATTERN),
      archiveDigest: z.string().regex(HASH_PATTERN),
      inputArtifactProvider: z.enum(["local", "s3"]),
      outputArtifactProvider: z.enum(["local", "s3"]),
      builderImageDigest: z.string().regex(IMAGE_DIGEST_PATTERN),
      issuedAt: z.date(),
      tokenExpiresAt: z.date(),
    })
    .strict()
    .safeParse(input);
  if (
    !parsed.success ||
    !validSourceRoot(input.sourceRoot) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(input.issuedAt.getTime()) ||
    !Number.isFinite(input.tokenExpiresAt.getTime()) ||
    input.issuedAt.getTime() > now.getTime() + CLOCK_SKEW_MS ||
    input.tokenExpiresAt.getTime() <= now.getTime() ||
    input.tokenExpiresAt.getTime() <= input.issuedAt.getTime() ||
    input.tokenExpiresAt.getTime() - input.issuedAt.getTime() > MAX_JOB_TTL_MS
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }
  // The Local CAS has no authenticated Agent transport or job-owned artifact
  // reference yet. Reject local placement before touching PostgreSQL rather
  // than letting a CHECK constraint fail or silently substituting S3.
  if (
    input.inputArtifactProvider === "local" ||
    input.outputArtifactProvider === "local"
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }
}

function sameRequest(
  row: PreviewBuildJob,
  input: CreatePreviewBuildJobInput,
): boolean {
  return (
    row.projectId === input.projectId &&
    row.proposalId === input.proposalId &&
    row.userId === input.userId &&
    row.operationId === input.operationId &&
    row.proposalRevision === input.proposalRevision &&
    row.candidateRevision === input.candidateRevision.toLowerCase() &&
    row.changeSetHash === input.changeSetHash.toLowerCase() &&
    row.sourceRoot === input.sourceRoot &&
    row.sourceDigest === input.sourceDigest.toLowerCase() &&
    row.archiveDigest === input.archiveDigest.toLowerCase() &&
    row.inputArtifactProvider === input.inputArtifactProvider &&
    row.outputArtifactProvider === input.outputArtifactProvider &&
    row.builderImageDigest === input.builderImageDigest.toLowerCase()
  );
}

export async function findPreviewBuildJobByRequest(input: {
  projectId: string;
  userId: string;
  clientRequestId: string;
}): Promise<PreviewBuildJob | null> {
  if (
    !UUID_PATTERN.test(input.clientRequestId) ||
    input.projectId.length < 1 ||
    input.projectId.length > 255 ||
    input.userId.length < 1 ||
    input.userId.length > 255
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }
  const [job] = await db
    .select()
    .from(previewBuildJobsTable)
    .where(
      and(
        eq(previewBuildJobsTable.projectId, input.projectId),
        eq(previewBuildJobsTable.userId, input.userId),
        eq(previewBuildJobsTable.clientRequestId, input.clientRequestId),
      ),
    )
    .limit(1);
  return job ?? null;
}

export async function findPreviewBuildJobForOwner(input: {
  jobId: string;
  projectId: string;
  userId: string;
}): Promise<PreviewBuildJob | null> {
  if (
    !UUID_PATTERN.test(input.jobId) ||
    input.projectId.length < 1 ||
    input.projectId.length > 255 ||
    input.userId.length < 1 ||
    input.userId.length > 255
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }
  const [job] = await db
    .select()
    .from(previewBuildJobsTable)
    .where(
      and(
        eq(previewBuildJobsTable.jobId, input.jobId),
        eq(previewBuildJobsTable.projectId, input.projectId),
        eq(previewBuildJobsTable.userId, input.userId),
      ),
    )
    .limit(1);
  return job ?? null;
}

export async function findPreviewBuildJobById(
  jobId: string,
): Promise<PreviewBuildJob | null> {
  if (!UUID_PATTERN.test(jobId)) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }
  const [job] = await db
    .select()
    .from(previewBuildJobsTable)
    .where(eq(previewBuildJobsTable.jobId, jobId))
    .limit(1);
  return job ?? null;
}

export async function findPreviewBuildJobsToReconcile(
  limit = 25,
  afterJobId?: string,
): Promise<PreviewBuildJob[]> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (afterJobId !== undefined && !UUID_PATTERN.test(afterJobId))
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }
  return db
    .select()
    .from(previewBuildJobsTable)
    .where(
      and(
        inArray(previewBuildJobsTable.status, [
          "queued",
          "launching",
          "running",
          "builder_succeeded",
        ]),
        ...(afterJobId ? [gt(previewBuildJobsTable.jobId, afterJobId)] : []),
      ),
    )
    .orderBy(asc(previewBuildJobsTable.jobId))
    .limit(limit);
}

const ACTIVE_BUILD_STATUSES = [
  "queued",
  "launching",
  "running",
  "builder_succeeded",
  "verified",
] as const satisfies readonly PreviewBuildJobStatus[];

export async function findActivePreviewBuildJob(input: {
  projectId: string;
  userId: string;
  proposalId: string;
}): Promise<PreviewBuildJob | null> {
  if (
    input.projectId.length < 1 ||
    input.projectId.length > 255 ||
    input.userId.length < 1 ||
    input.userId.length > 255 ||
    input.proposalId.length < 1 ||
    input.proposalId.length > 255
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }
  const [job] = await db
    .select()
    .from(previewBuildJobsTable)
    .where(
      and(
        eq(previewBuildJobsTable.projectId, input.projectId),
        eq(previewBuildJobsTable.userId, input.userId),
        eq(previewBuildJobsTable.proposalId, input.proposalId),
        inArray(previewBuildJobsTable.status, ACTIVE_BUILD_STATUSES),
      ),
    )
    .limit(1);
  return job ?? null;
}

export function previewBuildJobMatchesVerifiedReceipt(
  job: PreviewBuildJob,
  receipt: VerifiedPreviewBuildReceipt,
): boolean {
  return (
    isVerifiedPreviewBuildReceipt(receipt) &&
    job.projectId === receipt.projectId &&
    job.proposalId === receipt.proposalId &&
    job.operationId === receipt.operationId &&
    job.proposalRevision === receipt.proposalRevision &&
    job.candidateRevision === receipt.candidateRevision &&
    job.changeSetHash === receipt.changeSetHash &&
    job.sourceDigest === receipt.sourceDigest &&
    job.archiveDigest === receipt.archiveDigest &&
    job.buildId === receipt.buildId &&
    job.outputArtifactKey === receipt.outputArtifactKey &&
    job.builderImageDigest === receipt.builderImageDigest &&
    (receipt.version === 2
      ? receipt.attemptId === job.jobId &&
        receipt.idempotencyKey === job.clientRequestId &&
        receipt.dispatchGeneration === job.dispatchGeneration
      : job.dispatchGeneration === 1) &&
    (job.buildReceiptId === null || job.buildReceiptId === receipt.receiptId) &&
    job.outputDigest === receipt.buildOutputDigest
  );
}

export function previewBuildCandidateMatchesJob(
  candidate: {
    id: string;
    projectId: string;
    ownerId: string;
    operationId: string | null;
    status: string;
    lifecycle: string | null;
    revision: number;
    candidateTreeHash: string | null;
    changeSetHash: string | null;
    workspaceRoot: string | null;
  } | null,
  job: PreviewBuildJob,
): boolean {
  return Boolean(
    candidate &&
    candidate.id === job.proposalId &&
    candidate.projectId === job.projectId &&
    candidate.ownerId === job.userId &&
    candidate.status === "pending" &&
    (candidate.lifecycle === "isolated" ||
      candidate.lifecycle === "validated") &&
    candidate.operationId === job.operationId &&
    candidate.revision === job.proposalRevision &&
    candidate.candidateTreeHash === job.candidateRevision &&
    candidate.changeSetHash === job.changeSetHash &&
    candidate.workspaceRoot,
  );
}

/**
 * Admit a server-prepared Candidate as a durable build request.
 *
 * The route must establish the Candidate source root and digest before calling
 * this function. This transaction independently rechecks owner, Proposal
 * status/lifecycle, operation, revision, and Candidate hashes before writing.
 */
export async function createQueuedPreviewBuildJob(
  input: CreatePreviewBuildJobInput,
  now = new Date(),
): Promise<PreviewBuildJob | null> {
  assertCreateInput(input, now);

  return db.transaction(async (tx) => {
    await lockPreviewArtifactDigest(tx, input.archiveDigest);
    const [deletingArtifact] = await tx
      .select({ jobId: previewBuildJobsTable.jobId })
      .from(previewBuildJobsTable)
      .where(
        and(
          or(
            and(
              eq(previewBuildJobsTable.archiveDigest, input.archiveDigest),
              eq(previewBuildJobsTable.inputArtifactGcState, "deleting"),
            ),
            and(
              eq(previewBuildJobsTable.outputDigest, input.archiveDigest),
              eq(previewBuildJobsTable.outputArtifactGcState, "deleting"),
            ),
          ),
        ),
      )
      .limit(1);
    if (deletingArtifact) {
      throw new PreviewBuildJobStoreError(
        "PREVIEW_BUILD_ARTIFACT_GC_IN_PROGRESS",
      );
    }

    const [candidate] = await tx
      .select({
        id: aiChangeProposalsTable.id,
        projectId: aiChangeProposalsTable.projectId,
        ownerId: projectsTable.ownerId,
        operationId: aiChangeProposalsTable.operationId,
        status: aiChangeProposalsTable.status,
        lifecycle: aiChangeProposalsTable.lifecycle,
        revision: aiChangeProposalsTable.revision,
        candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
        changeSetHash: aiChangeProposalsTable.changeSetHash,
        workspaceRoot: aiChangeProposalsTable.workspaceRoot,
      })
      .from(aiChangeProposalsTable)
      .innerJoin(
        projectsTable,
        eq(aiChangeProposalsTable.projectId, projectsTable.id),
      )
      .where(
        and(
          eq(aiChangeProposalsTable.id, input.proposalId),
          eq(aiChangeProposalsTable.projectId, input.projectId),
          eq(projectsTable.ownerId, input.userId),
        ),
      )
      .for("update");

    if (
      !candidate ||
      candidate.status !== "pending" ||
      (candidate.lifecycle !== "isolated" &&
        candidate.lifecycle !== "validated") ||
      !candidate.workspaceRoot ||
      candidate.operationId !== input.operationId ||
      candidate.revision !== input.proposalRevision ||
      candidate.candidateTreeHash !== input.candidateRevision.toLowerCase() ||
      candidate.changeSetHash !== input.changeSetHash.toLowerCase()
    ) {
      return null;
    }

    const [existing] = await tx
      .select()
      .from(previewBuildJobsTable)
      .where(
        and(
          eq(previewBuildJobsTable.projectId, input.projectId),
          eq(previewBuildJobsTable.userId, input.userId),
          eq(previewBuildJobsTable.clientRequestId, input.clientRequestId),
        ),
      )
      .for("update");

    if (existing) {
      if (!sameRequest(existing, input)) {
        throw new PreviewBuildJobStoreError(
          "PREVIEW_BUILD_JOB_IDEMPOTENCY_CONFLICT",
        );
      }
      return existing;
    }

    const [activeJob] = await tx
      .select()
      .from(previewBuildJobsTable)
      .where(
        and(
          eq(previewBuildJobsTable.projectId, input.projectId),
          eq(previewBuildJobsTable.userId, input.userId),
          eq(previewBuildJobsTable.proposalId, input.proposalId),
          inArray(previewBuildJobsTable.status, ACTIVE_BUILD_STATUSES),
        ),
      )
      .for("update");
    if (activeJob) {
      throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_ALREADY_ACTIVE");
    }

    const jobId = randomUUID();
    const buildId = randomUUID();
    const inputArtifactKey = previewBuildInputObjectKeyForArchive({
      identity: {
        projectId: input.projectId,
        proposalId: input.proposalId,
        operationId: input.operationId,
        proposalRevision: input.proposalRevision,
        candidateRevision: input.candidateRevision.toLowerCase(),
        changeSetHash: input.changeSetHash.toLowerCase(),
      },
      sourceDigest: input.sourceDigest.toLowerCase(),
      archiveDigest: input.archiveDigest.toLowerCase(),
    });
    const outputArtifactKey = `preview-build-outputs/${buildId}/site.tar.gz`;
    const [created] = await tx
      .insert(previewBuildJobsTable)
      .values({
        jobId,
        buildId,
        projectId: input.projectId,
        proposalId: input.proposalId,
        userId: input.userId,
        clientRequestId: input.clientRequestId,
        operationId: input.operationId,
        proposalRevision: input.proposalRevision,
        candidateRevision: input.candidateRevision.toLowerCase(),
        changeSetHash: input.changeSetHash.toLowerCase(),
        sourceRoot: input.sourceRoot,
        sourceDigest: input.sourceDigest.toLowerCase(),
        archiveDigest: input.archiveDigest.toLowerCase(),
        inputArtifactKey,
        inputArtifactProvider: input.inputArtifactProvider,
        inputArtifactReadyAt: null,
        inputArtifactGcState: "active",
        inputArtifactGcMarkedAt: null,
        outputArtifactKey,
        outputArtifactProvider: input.outputArtifactProvider,
        outputArtifactGcState: "active",
        outputArtifactGcMarkedAt: null,
        builderImageDigest: input.builderImageDigest.toLowerCase(),
        issuedAt: input.issuedAt,
        tokenExpiresAt: input.tokenExpiresAt,
        dispatchGeneration: 1,
      })
      .onConflictDoNothing({
        target: [
          previewBuildJobsTable.projectId,
          previewBuildJobsTable.userId,
          previewBuildJobsTable.clientRequestId,
        ],
      })
      .returning();

    if (created) return created;

    const [raced] = await tx
      .select()
      .from(previewBuildJobsTable)
      .where(
        and(
          eq(previewBuildJobsTable.projectId, input.projectId),
          eq(previewBuildJobsTable.userId, input.userId),
          eq(previewBuildJobsTable.clientRequestId, input.clientRequestId),
        ),
      )
      .for("update");
    if (!raced || !sameRequest(raced, input)) {
      throw new PreviewBuildJobStoreError(
        "PREVIEW_BUILD_JOB_IDEMPOTENCY_CONFLICT",
      );
    }
    return raced;
  });
}

export async function markPreviewBuildInputReady(input: {
  jobId: string;
  expectedVersion: number;
  inputArtifactKey: string;
  archiveDigest: string;
  now: Date;
}): Promise<PreviewBuildJob | null> {
  if (
    !UUID_PATTERN.test(input.jobId) ||
    !HASH_PATTERN.test(input.archiveDigest) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }

  return db.transaction(async (tx) => {
    await lockPreviewArtifactDigest(tx, input.archiveDigest);
    const [current] = await tx
      .select()
      .from(previewBuildJobsTable)
      .where(eq(previewBuildJobsTable.jobId, input.jobId))
      .for("update");
    if (!current) return null;
    if (
      current.status !== "queued" ||
      current.stateVersion !== input.expectedVersion ||
      current.inputArtifactKey !== input.inputArtifactKey ||
      current.archiveDigest !== input.archiveDigest.toLowerCase() ||
      current.inputArtifactGcState !== "active" ||
      current.tokenExpiresAt.getTime() <= input.now.getTime()
    ) {
      return null;
    }
    if (current.inputArtifactReadyAt) return current;

    const [candidate] = await tx
      .select({
        id: aiChangeProposalsTable.id,
        projectId: aiChangeProposalsTable.projectId,
        ownerId: projectsTable.ownerId,
        operationId: aiChangeProposalsTable.operationId,
        status: aiChangeProposalsTable.status,
        lifecycle: aiChangeProposalsTable.lifecycle,
        revision: aiChangeProposalsTable.revision,
        candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
        changeSetHash: aiChangeProposalsTable.changeSetHash,
        workspaceRoot: aiChangeProposalsTable.workspaceRoot,
      })
      .from(aiChangeProposalsTable)
      .innerJoin(
        projectsTable,
        eq(aiChangeProposalsTable.projectId, projectsTable.id),
      )
      .where(
        and(
          eq(aiChangeProposalsTable.id, current.proposalId),
          eq(aiChangeProposalsTable.projectId, current.projectId),
          eq(projectsTable.ownerId, current.userId),
        ),
      )
      .for("update");
    if (!previewBuildCandidateMatchesJob(candidate ?? null, current)) {
      return null;
    }

    const [updated] = await tx
      .update(previewBuildJobsTable)
      .set({
        inputArtifactReadyAt: input.now,
        inputArtifactGcState: "active",
        inputArtifactGcMarkedAt: null,
        updatedAt: input.now,
        stateVersion: sql<number>`${previewBuildJobsTable.stateVersion} + 1`,
      })
      .where(
        and(
          eq(previewBuildJobsTable.jobId, input.jobId),
          eq(previewBuildJobsTable.status, "queued"),
          eq(previewBuildJobsTable.stateVersion, input.expectedVersion),
          eq(previewBuildJobsTable.inputArtifactKey, input.inputArtifactKey),
          isNull(previewBuildJobsTable.inputArtifactReadyAt),
          eq(previewBuildJobsTable.inputArtifactGcState, "active"),
        ),
      )
      .returning();
    return updated ?? null;
  });
}

export type PreviewBuildJobTransitionInput = {
  jobId: string;
  expectedStatus: PreviewBuildJobStatus;
  expectedVersion: number;
  now: Date;
} & (
  | {
      nextStatus: "launching" | "expired" | "cancelled";
      executionRef?: never;
      outputDigest?: never;
      failureCode?: never;
      verifiedReceipt?: never;
    }
  | {
      nextStatus: "running";
      executionRef: string;
      outputDigest?: never;
      failureCode?: never;
      verifiedReceipt?: never;
    }
  | {
      nextStatus: "builder_succeeded";
      executionRef: string;
      outputDigest: string;
      failureCode?: never;
      verifiedReceipt?: never;
    }
  | {
      nextStatus: "verified";
      executionRef: string;
      verifiedReceipt: VerifiedPreviewBuildReceipt;
      outputDigest?: never;
      failureCode?: never;
    }
  | {
      nextStatus: "failed";
      failureCode: string;
      executionRef?: never;
      outputDigest?: never;
      verifiedReceipt?: never;
    }
);

export async function transitionPreviewBuildJob(
  input: PreviewBuildJobTransitionInput,
): Promise<PreviewBuildJob | null> {
  if (
    !UUID_PATTERN.test(input.jobId) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_INPUT_INVALID");
  }

  try {
    assertPreviewBuildJobTransition(input.expectedStatus, input.nextStatus);
    if (
      input.nextStatus === "verified" &&
      !isVerifiedPreviewBuildReceipt(input.verifiedReceipt)
    ) {
      throw new Error("A verified receipt is required.");
    }
    assertPreviewBuildJobTransitionData(input.nextStatus, {
      executionRef: input.executionRef,
      outputDigest:
        input.nextStatus === "verified"
          ? input.verifiedReceipt.buildOutputDigest
          : input.outputDigest,
      buildReceiptId:
        input.nextStatus === "verified"
          ? input.verifiedReceipt.receiptId
          : undefined,
      failureCode: input.failureCode,
    });
  } catch {
    throw new PreviewBuildJobStoreError("PREVIEW_BUILD_JOB_TRANSITION_INVALID");
  }

  if (input.nextStatus === "verified") {
    const receipt = input.verifiedReceipt;
    return db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(eq(previewBuildJobsTable.jobId, input.jobId))
        .limit(1);
      if (!snapshot) return null;

      const [candidate] = await tx
        .select({
          id: aiChangeProposalsTable.id,
          projectId: aiChangeProposalsTable.projectId,
          ownerId: projectsTable.ownerId,
          operationId: aiChangeProposalsTable.operationId,
          status: aiChangeProposalsTable.status,
          lifecycle: aiChangeProposalsTable.lifecycle,
          revision: aiChangeProposalsTable.revision,
          candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
          changeSetHash: aiChangeProposalsTable.changeSetHash,
          workspaceRoot: aiChangeProposalsTable.workspaceRoot,
        })
        .from(aiChangeProposalsTable)
        .innerJoin(
          projectsTable,
          eq(aiChangeProposalsTable.projectId, projectsTable.id),
        )
        .where(
          and(
            eq(aiChangeProposalsTable.id, snapshot.proposalId),
            eq(aiChangeProposalsTable.projectId, snapshot.projectId),
            eq(projectsTable.ownerId, snapshot.userId),
          ),
        )
        .for("update");
      if (!previewBuildCandidateMatchesJob(candidate ?? null, snapshot)) {
        return null;
      }

      const [current] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(
          and(
            eq(previewBuildJobsTable.jobId, input.jobId),
            eq(previewBuildJobsTable.status, input.expectedStatus),
            eq(previewBuildJobsTable.stateVersion, input.expectedVersion),
          ),
        )
        .for("update");
      if (!current) return null;
      if (
        !previewBuildJobMatchesVerifiedReceipt(current, receipt) ||
        Date.parse(receipt.expiresAt) <= input.now.getTime() ||
        current.executionRef !== input.executionRef
      ) {
        throw new PreviewBuildJobStoreError(
          "PREVIEW_BUILD_JOB_TRANSITION_INVALID",
        );
      }

      const [updated] = await tx
        .update(previewBuildJobsTable)
        .set({
          status: "verified",
          outputDigest: receipt.buildOutputDigest.toLowerCase(),
          buildReceiptId: receipt.receiptId,
          completedAt: input.now,
          updatedAt: input.now,
          stateVersion: sql<number>`${previewBuildJobsTable.stateVersion} + 1`,
        })
        .where(
          and(
            eq(previewBuildJobsTable.jobId, input.jobId),
            eq(previewBuildJobsTable.status, input.expectedStatus),
            eq(previewBuildJobsTable.stateVersion, input.expectedVersion),
            eq(previewBuildJobsTable.executionRef, input.executionRef),
            eq(
              previewBuildJobsTable.outputDigest,
              receipt.buildOutputDigest.toLowerCase(),
            ),
          ),
        )
        .returning();
      return updated ?? null;
    });
  }

  const patch: Omit<
    Partial<typeof previewBuildJobsTable.$inferInsert>,
    "stateVersion"
  > = {
    status: input.nextStatus,
    updatedAt: input.now,
  };
  if (input.nextStatus === "running") {
    patch.executionRef = input.executionRef;
    patch.startedAt = input.now;
  } else if (input.nextStatus === "builder_succeeded") {
    patch.outputDigest = input.outputDigest?.toLowerCase();
  } else if (input.nextStatus === "failed") {
    patch.failureCode = input.failureCode;
    patch.completedAt = input.now;
  } else if (
    input.nextStatus === "expired" ||
    input.nextStatus === "cancelled"
  ) {
    patch.completedAt = input.now;
  }

  const predicates = [
    eq(previewBuildJobsTable.jobId, input.jobId),
    eq(previewBuildJobsTable.status, input.expectedStatus),
    eq(previewBuildJobsTable.stateVersion, input.expectedVersion),
  ];
  if (input.nextStatus === "builder_succeeded") {
    predicates.push(
      eq(previewBuildJobsTable.executionRef, input.executionRef!),
    );
  }
  if (input.nextStatus === "launching") {
    predicates.push(
      gt(previewBuildJobsTable.tokenExpiresAt, input.now),
      isNotNull(previewBuildJobsTable.inputArtifactReadyAt),
      eq(previewBuildJobsTable.inputArtifactGcState, "active"),
    );
  }

  const [updated] = await db
    .update(previewBuildJobsTable)
    .set({
      ...patch,
      stateVersion: sql<number>`${previewBuildJobsTable.stateVersion} + 1`,
    })
    .where(and(...predicates))
    .returning();
  return updated ?? null;
}
