import { and, eq, sql } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  previewBuildJobsTable,
} from "@workspace/db";
import {
  LOCAL_PREVIEW_INPUT_DELETE_GRACE_MS,
  LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS,
  LOCAL_PREVIEW_INPUT_RETENTION_MS,
} from "./preview-build-input-gc.js";
import {
  previewBuildArtifactRefId,
} from "./preview-artifact-reference.js";
import { lockPreviewArtifactDigest } from "./preview-artifact-db-lock.js";
import {
  previewArtifactDeleteCommandFingerprint,
  previewArtifactDeleteCommandId,
  signPreviewArtifactDeleteCommand,
  verifyPreviewArtifactDeletePollProof,
  type PreviewArtifactDeleteCommandClaims,
} from "./preview-artifact-gc-command.js";
import { previewAgentOwnsBuildArtifact } from "./preview-artifact-store-issuer.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_TTL_MS = 30_000;
const TERMINAL_STATUSES = ["verified", "failed", "expired", "cancelled"] as const;

export class PreviewArtifactGcCommandIssueError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_INVALID"
      | "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT"
      | "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_UNAVAILABLE",
  ) {
    super("Preview artifact delete command is unavailable.");
    this.name = "PreviewArtifactGcCommandIssueError";
  }
}

export type PreviewArtifactGcCommandIssue = {
  commandId: string;
  commandFingerprint: string;
  expiresAt: Date;
  commandToken: string;
};

export function previewBuildJobHasGcArtifact(
  job: typeof previewBuildJobsTable.$inferSelect,
) {
  return Boolean(
    job.inputArtifactProvider === "local" &&
      job.inputArtifactStoreId &&
      job.inputArtifactRefId ===
        previewBuildArtifactRefId(job.jobId, "input") &&
      Number.isSafeInteger(job.inputArtifactSizeBytes) &&
      job.inputArtifactSizeBytes! > 0 &&
      job.inputArtifactManifestDigest &&
      job.inputArtifactRetentionPolicy === "preview-build-input-24h-v1" &&
      job.inputArtifactOwnerNodeId &&
      Number.isSafeInteger(job.inputArtifactOwnerKeyVersion) &&
      job.inputArtifactOwnerKeyVersion! > 0 &&
      job.archiveDigest &&
      job.candidateRevision &&
      job.changeSetHash &&
      job.proposalRevision > 0,
  );
}

function commandClaims(input: {
  job: typeof previewBuildJobsTable.$inferSelect;
  nodeId: string;
  keyVersion: number;
  gcLeaseAt: Date;
  now: Date;
}): PreviewArtifactDeleteCommandClaims {
  const { job, nodeId, keyVersion, gcLeaseAt, now } = input;
  if (!previewBuildJobHasGcArtifact(job)) {
    throw new PreviewArtifactGcCommandIssueError(
      "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
    );
  }
  const expiresAt = new Date(
    Math.min(
      now.getTime() + COMMAND_TTL_MS,
      gcLeaseAt.getTime() + LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS,
    ),
  );
  if (expiresAt.getTime() <= now.getTime()) {
    throw new PreviewArtifactGcCommandIssueError(
      "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
    );
  }
  return {
    version: 2,
    action: "delete-artifact",
    commandId: previewArtifactDeleteCommandId({
      nodeId,
      keyVersion,
      jobId: job.jobId,
      artifactRefId: job.inputArtifactRefId!,
      gcLeaseAt: gcLeaseAt.toISOString(),
    }),
    nodeId,
    keyVersion,
    storeId: job.inputArtifactStoreId!,
    artifactRefId: job.inputArtifactRefId!,
    jobId: job.jobId,
    projectId: job.projectId,
    proposalId: job.proposalId,
    operationId: job.operationId,
    proposalRevision: job.proposalRevision,
    candidateRevision: job.candidateRevision,
    changeSetHash: job.changeSetHash,
    artifactKind: "preview-build-input",
    artifactDigest: job.archiveDigest,
    sizeBytes: job.inputArtifactSizeBytes!,
    manifestDigest: job.inputArtifactManifestDigest!,
    retentionPolicy: "preview-build-input-24h-v1",
    gcLeaseAt: gcLeaseAt.toISOString(),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * A paired owner can poll only for the Job whose signed proof names it. The
 * Job row remains the queue: this does not create a second dispatch table or
 * perform deletion. Eligible rows move through the existing GC state fields.
 */
export async function issuePreviewBuildInputDeleteCommand(input: {
  jobId: string;
  proof: unknown;
  signature: string;
  buildJobPrivateKeyPem: string | undefined;
  now?: Date;
}): Promise<PreviewArtifactGcCommandIssue | null> {
  const now = input.now ?? new Date();
  if (
    !UUID_PATTERN.test(input.jobId) ||
    !Number.isFinite(now.getTime()) ||
    !input.proof ||
    typeof input.proof !== "object" ||
    Array.isArray(input.proof)
  ) {
    throw new PreviewArtifactGcCommandIssueError(
      "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_INVALID",
    );
  }
  if (!input.buildJobPrivateKeyPem) {
    throw new PreviewArtifactGcCommandIssueError(
      "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_UNAVAILABLE",
    );
  }

  try {
    const proofRecord = input.proof as Record<string, unknown>;
    const proofNodeId = proofRecord.nodeId;
    const proofJobId = proofRecord.jobId;
    if (
      typeof proofNodeId !== "string" ||
      !UUID_PATTERN.test(proofNodeId) ||
      proofJobId !== input.jobId
    ) {
      throw new PreviewArtifactGcCommandIssueError(
        "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_INVALID",
      );
    }

    return await db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(eq(previewBuildJobsTable.jobId, input.jobId))
        .limit(1);
      if (!snapshot) {
        throw new PreviewArtifactGcCommandIssueError(
          "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
        );
      }
      await lockPreviewArtifactDigest(tx, snapshot.archiveDigest);
      const [job] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(eq(previewBuildJobsTable.jobId, input.jobId))
        .for("update")
        .limit(1);
      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, proofNodeId))
        .for("update")
        .limit(1);

      if (
        !job ||
        !node ||
        !node.publicKeyPem ||
        node.nodeId !== proofNodeId
      ) {
        throw new PreviewArtifactGcCommandIssueError(
          "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
        );
      }

      let proof;
      try {
        proof = verifyPreviewArtifactDeletePollProof({
          proof: input.proof,
          signature: input.signature,
          publicKeyPem: node.publicKeyPem,
          now,
        });
      } catch {
        throw new PreviewArtifactGcCommandIssueError(
          "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_INVALID",
        );
      }

      if (
        proof.jobId !== job.jobId ||
        proof.nodeId !== job.inputArtifactOwnerNodeId ||
        !previewAgentOwnsBuildArtifact(node, proof, job) ||
        node.status !== "active" ||
        !previewBuildJobHasGcArtifact(job) ||
        !TERMINAL_STATUSES.includes(
          job.status as (typeof TERMINAL_STATUSES)[number],
        ) ||
        !job.completedAt ||
        job.completedAt.getTime() >
          now.getTime() - LOCAL_PREVIEW_INPUT_RETENTION_MS
      ) {
        throw new PreviewArtifactGcCommandIssueError(
          "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
        );
      }

      if (job.inputArtifactGcState === "active") {
        await tx
          .update(previewBuildJobsTable)
          .set({
            inputArtifactGcState: "eligible_for_gc",
            inputArtifactGcMarkedAt: now,
            updatedAt: now,
            stateVersion: sql<number>`${previewBuildJobsTable.stateVersion} + 1`,
          })
          .where(
            and(
              eq(previewBuildJobsTable.jobId, job.jobId),
              eq(previewBuildJobsTable.stateVersion, job.stateVersion),
              eq(previewBuildJobsTable.inputArtifactGcState, "active"),
            ),
          );
        return null;
      }

      let gcLeaseAt: Date | null = null;
      if (job.inputArtifactGcState === "eligible_for_gc") {
        const eligibleAt = job.inputArtifactGcMarkedAt;
        if (
          !eligibleAt ||
          eligibleAt.getTime() + LOCAL_PREVIEW_INPUT_DELETE_GRACE_MS >
            now.getTime()
        ) {
          return null;
        }
        gcLeaseAt = now;
      } else if (job.inputArtifactGcState === "deleting") {
        const currentLease = job.inputArtifactGcMarkedAt;
        if (!currentLease) {
          throw new PreviewArtifactGcCommandIssueError(
            "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
          );
        }
        gcLeaseAt =
          currentLease.getTime() + LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS <=
          now.getTime()
            ? now
            : currentLease;
      } else {
        return null;
      }

      if (job.inputArtifactGcState !== "deleting" ||
        job.inputArtifactGcMarkedAt?.getTime() !== gcLeaseAt.getTime()) {
        const [claimed] = await tx
          .update(previewBuildJobsTable)
          .set({
            inputArtifactGcState: "deleting",
            inputArtifactGcMarkedAt: gcLeaseAt,
            updatedAt: now,
            stateVersion: sql<number>`${previewBuildJobsTable.stateVersion} + 1`,
          })
          .where(
            and(
              eq(previewBuildJobsTable.jobId, job.jobId),
              eq(previewBuildJobsTable.stateVersion, job.stateVersion),
              eq(previewBuildJobsTable.inputArtifactGcState, job.inputArtifactGcState),
            ),
          )
          .returning({ jobId: previewBuildJobsTable.jobId });
        if (!claimed) {
          throw new PreviewArtifactGcCommandIssueError(
            "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_CONFLICT",
          );
        }
      }

      const claims = commandClaims({
        job,
        nodeId: proof.nodeId,
        keyVersion: proof.keyVersion,
        gcLeaseAt,
        now,
      });
      const commandToken = signPreviewArtifactDeleteCommand({
        claims,
        privateKeyPem: input.buildJobPrivateKeyPem,
        now,
      });
      return {
        commandId: claims.commandId,
        commandFingerprint: previewArtifactDeleteCommandFingerprint(claims),
        expiresAt: new Date(claims.expiresAt),
        commandToken,
      };
    });
  } catch (error) {
    if (error instanceof PreviewArtifactGcCommandIssueError) throw error;
    throw new PreviewArtifactGcCommandIssueError(
      "PREVIEW_ARTIFACT_GC_COMMAND_ISSUE_UNAVAILABLE",
    );
  }
}
