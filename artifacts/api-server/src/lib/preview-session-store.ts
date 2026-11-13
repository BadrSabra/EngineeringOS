import {
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  aiChangeProposalsTable,
  db,
  previewBuildJobsTable,
  previewSessionsTable,
  projectsTable,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  isVerifiedPreviewBuildReceipt,
  type VerifiedPreviewBuildReceipt,
} from "./preview-build-receipt.js";
import {
  isVerifiedPreviewRuntimeProfile,
  type VerifiedPreviewRuntimeProfile,
} from "./preview-runtime-profile.js";
import {
  assertPreviewSessionTransition,
  type PreviewSessionStatus,
} from "./preview-session-state.js";
import { previewBuildJobMatchesVerifiedReceipt } from "./preview-build-job-store.js";
import { lockPreviewArtifactDigest } from "./preview-artifact-db-lock.js";

const MAX_SESSION_TTL_MS = 30 * 60 * 1000;
const sessionIdSchema = z.string().uuid();
const imageDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/i);
const taskDefinitionArnSchema = z
  .string()
  .regex(
    /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+$/i,
  );
const runnerTaskArnSchema = z
  .string()
  .regex(
    /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i,
  );

export class PreviewSessionStoreError extends Error {
  constructor(readonly code: "PREVIEW_SESSION_INPUT_INVALID") {
    super("Preview session request is invalid.");
    this.name = "PreviewSessionStoreError";
  }
}

export type CreatePreviewSessionInput = {
  projectId: string;
  userId: string;
  buildReceipt: VerifiedPreviewBuildReceipt;
  runtimeProfile: VerifiedPreviewRuntimeProfile;
  expiresAt: Date;
};

export type PreviewSessionTransitionInput = {
  sessionId: string;
  expectedStatus: PreviewSessionStatus;
  expectedVersion: number;
  nextStatus: PreviewSessionStatus;
  now: Date;
};

function currentCandidateExists(sessionId: string) {
  return db
    .select({ id: aiChangeProposalsTable.id })
    .from(previewSessionsTable)
    .innerJoin(
      aiChangeProposalsTable,
      eq(previewSessionsTable.proposalId, aiChangeProposalsTable.id),
    )
    .innerJoin(
      projectsTable,
      eq(aiChangeProposalsTable.projectId, projectsTable.id),
    )
    .where(
      and(
        eq(previewSessionsTable.id, sessionId),
        eq(
          aiChangeProposalsTable.revision,
          previewSessionsTable.proposalRevision,
        ),
        eq(
          aiChangeProposalsTable.candidateTreeHash,
          previewSessionsTable.candidateRevision,
        ),
        eq(
          aiChangeProposalsTable.changeSetHash,
          previewSessionsTable.changeSetHash,
        ),
        eq(aiChangeProposalsTable.status, "pending"),
        inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"]),
        eq(projectsTable.ownerId, previewSessionsTable.userId),
      ),
    )
    .limit(1);
}

export async function createStartingPreviewSession(
  input: CreatePreviewSessionInput,
  now = new Date(),
) {
  const receipt = input.buildReceipt;
  if (
    !isVerifiedPreviewBuildReceipt(receipt) ||
    !isVerifiedPreviewRuntimeProfile(input.runtimeProfile) ||
    receipt.projectId !== input.projectId ||
    Date.parse(receipt.expiresAt) <= now.getTime() ||
    !imageDigestSchema.safeParse(input.runtimeProfile.imageDigest).success ||
    !taskDefinitionArnSchema.safeParse(input.runtimeProfile.taskDefinitionArn)
      .success
  ) {
    throw new PreviewSessionStoreError("PREVIEW_SESSION_INPUT_INVALID");
  }
  const validInput = z
    .object({
      projectId: z.string().min(1).max(255),
      userId: z.string().min(1).max(255),
      expiresAt: z.date(),
    })
    .strict()
    .safeParse({
      projectId: input.projectId,
      userId: input.userId,
      expiresAt: input.expiresAt,
    });

  if (
    !validInput.success ||
    !Number.isFinite(now.getTime()) ||
    input.expiresAt.getTime() <= now.getTime() ||
    input.expiresAt.getTime() - now.getTime() > MAX_SESSION_TTL_MS
  ) {
    throw new PreviewSessionStoreError("PREVIEW_SESSION_INPUT_INVALID");
  }

  return db.transaction(async (tx) => {
    await lockPreviewArtifactDigest(tx, receipt.buildOutputDigest);
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
      })
      .from(aiChangeProposalsTable)
      .innerJoin(
        projectsTable,
        eq(aiChangeProposalsTable.projectId, projectsTable.id),
      )
      .where(
        and(
          eq(aiChangeProposalsTable.id, receipt.proposalId),
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
      candidate.operationId !== receipt.operationId ||
      candidate.revision !== receipt.proposalRevision ||
      candidate.candidateTreeHash !== receipt.candidateRevision ||
      candidate.changeSetHash !== receipt.changeSetHash
    ) {
      return null;
    }

    const [buildJob] = await tx
      .select()
      .from(previewBuildJobsTable)
      .where(
        and(
          eq(previewBuildJobsTable.buildId, receipt.buildId),
          eq(previewBuildJobsTable.projectId, input.projectId),
          eq(previewBuildJobsTable.proposalId, receipt.proposalId),
          eq(previewBuildJobsTable.userId, input.userId),
          eq(previewBuildJobsTable.status, "verified"),
          eq(previewBuildJobsTable.buildReceiptId, receipt.receiptId),
          eq(previewBuildJobsTable.outputArtifactGcState, "active"),
        ),
      )
      .for("update");
    if (
      !buildJob ||
      !previewBuildJobMatchesVerifiedReceipt(buildJob, receipt)
    ) {
      return null;
    }

    const [session] = await tx
      .insert(previewSessionsTable)
      .values({
        proposalId: candidate.id,
        userId: input.userId,
        proposalRevision: candidate.revision,
        candidateRevision: candidate.candidateTreeHash,
        changeSetHash: candidate.changeSetHash,
        buildJobId: buildJob.jobId,
        buildReceiptId: receipt.receiptId,
        buildOutputArtifactKey: receipt.outputArtifactKey,
        buildOutputDigest: receipt.buildOutputDigest,
        imageDigest: input.runtimeProfile.imageDigest,
        taskDefinitionArn: input.runtimeProfile.taskDefinitionArn,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing({
        target: previewSessionsTable.buildReceiptId,
      })
      .returning();

    return session ?? null;
  });
}

export async function transitionPreviewSession(
  input: PreviewSessionTransitionInput,
): Promise<typeof previewSessionsTable.$inferSelect | null> {
  assertPreviewSessionTransition(input.expectedStatus, input.nextStatus);
  if (
    !sessionIdSchema.safeParse(input.sessionId).success ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0
  ) {
    throw new PreviewSessionStoreError("PREVIEW_SESSION_INPUT_INVALID");
  }

  const transitionFields: Partial<typeof previewSessionsTable.$inferInsert> =
    {};
  if (input.nextStatus === "ready") {
    transitionFields.readyAt = input.now;
  }

  if (
    input.nextStatus === "stopped" ||
    input.nextStatus === "failed" ||
    input.nextStatus === "expired"
  ) {
    transitionFields.closedAt = input.now;
  }

  const set = {
    ...transitionFields,
    status: input.nextStatus,
    stateVersion: sql<number>`${previewSessionsTable.stateVersion} + 1`,
    updatedAt: input.now,
  };

  const predicates = [
    eq(previewSessionsTable.id, input.sessionId),
    eq(previewSessionsTable.status, input.expectedStatus),
    eq(previewSessionsTable.stateVersion, input.expectedVersion),
  ];

  if (input.nextStatus === "ready") {
    predicates.push(
      gt(previewSessionsTable.expiresAt, input.now),
      exists(currentCandidateExists(input.sessionId)),
      isNotNull(previewSessionsTable.runnerTaskArn),
    );
  } else if (input.nextStatus === "expired") {
    predicates.push(lte(previewSessionsTable.expiresAt, input.now));
  }

  const [session] = await db
    .update(previewSessionsTable)
    .set(set)
    .where(and(...predicates))
    .returning();

  return session ?? null;
}

export async function attachPreviewSessionTask(input: {
  sessionId: string;
  expectedVersion: number;
  runnerTaskArn: string;
  now: Date;
}): Promise<typeof previewSessionsTable.$inferSelect | null> {
  if (
    !sessionIdSchema.safeParse(input.sessionId).success ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !runnerTaskArnSchema.safeParse(input.runnerTaskArn).success
  ) {
    throw new PreviewSessionStoreError("PREVIEW_SESSION_INPUT_INVALID");
  }

  const [session] = await db
    .update(previewSessionsTable)
    .set({
      runnerTaskArn: input.runnerTaskArn,
      stateVersion: sql<number>`${previewSessionsTable.stateVersion} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(previewSessionsTable.id, input.sessionId),
        eq(previewSessionsTable.status, "starting"),
        eq(previewSessionsTable.stateVersion, input.expectedVersion),
        isNull(previewSessionsTable.runnerTaskArn),
        gt(previewSessionsTable.expiresAt, input.now),
        exists(currentCandidateExists(input.sessionId)),
      ),
    )
    .returning();

  return session ?? null;
}
