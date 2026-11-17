import { and, eq, sql } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  previewBuildJobsTable,
  type PreviewBuildJob,
} from "@workspace/db";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";
import {
  LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS,
  LOCAL_PREVIEW_INPUT_RETENTION_MS,
} from "./preview-build-input-gc.js";
import { lockPreviewArtifactDigest } from "./preview-artifact-db-lock.js";
import {
  previewArtifactDeleteCommandFingerprint,
  previewArtifactDeleteCommandId,
  previewArtifactDeleteCommandPublicKeyPem,
  previewArtifactDeleteReceiptCompletedAtHint,
  verifyPreviewArtifactDeleteCommand,
  verifyPreviewArtifactDeleteReceipt,
} from "./preview-artifact-gc-command.js";
import { previewBuildJobHasGcArtifact } from "./preview-artifact-gc-issuer.js";
import { previewAgentOwnsBuildArtifact } from "./preview-artifact-store-issuer.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = ["verified", "failed", "expired", "cancelled"] as const;

export class PreviewArtifactGcAcceptanceError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ARTIFACT_GC_ACCEPTANCE_INVALID"
      | "PREVIEW_ARTIFACT_GC_ACCEPTANCE_CONFLICT"
      | "PREVIEW_ARTIFACT_GC_ACCEPTANCE_UNAVAILABLE",
  ) {
    super("Preview artifact delete receipt is invalid or unavailable.");
    this.name = "PreviewArtifactGcAcceptanceError";
  }
}

export type PreviewArtifactGcAcceptanceResult = {
  job: PreviewBuildJob;
  alreadyAccepted: boolean;
};

function commandMatchesJob(
  command: ReturnType<typeof verifyPreviewArtifactDeleteCommand>,
  job: PreviewBuildJob,
): boolean {
  return Boolean(
    command.jobId === job.jobId &&
      command.projectId === job.projectId &&
      command.proposalId === job.proposalId &&
      command.operationId === job.operationId &&
      command.proposalRevision === job.proposalRevision &&
      command.candidateRevision === job.candidateRevision &&
      command.changeSetHash === job.changeSetHash &&
      command.nodeId === job.inputArtifactOwnerNodeId &&
      command.keyVersion === job.inputArtifactOwnerKeyVersion &&
      command.storeId === job.inputArtifactStoreId &&
      command.artifactRefId === job.inputArtifactRefId &&
      command.artifactRefId === previewBuildArtifactRefId(job.jobId, "input") &&
      command.artifactDigest === job.archiveDigest &&
      command.sizeBytes === job.inputArtifactSizeBytes &&
      command.manifestDigest === job.inputArtifactManifestDigest &&
      command.retentionPolicy === job.inputArtifactRetentionPolicy &&
      job.inputArtifactGcMarkedAt?.toISOString() === command.gcLeaseAt &&
      command.commandId ===
        previewArtifactDeleteCommandId({
          nodeId: command.nodeId,
          keyVersion: command.keyVersion,
          jobId: command.jobId,
          artifactRefId: command.artifactRefId,
          gcLeaseAt: command.gcLeaseAt,
        }) &&
      Date.parse(command.expiresAt) <=
        Date.parse(command.gcLeaseAt) + LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS &&
      job.completedAt !== null &&
      job.completedAt.getTime() <=
        Date.parse(command.issuedAt) - LOCAL_PREVIEW_INPUT_RETENTION_MS &&
      TERMINAL_STATUSES.includes(
        job.status as (typeof TERMINAL_STATUSES)[number],
      ),
  );
}

/**
 * Accepts only an owner-signed receipt for the exact currently claimed artifact
 * and lease. Duplicate delivery for the same deleted lease is a no-op; a receipt
 * from an earlier lease cannot complete a reclaimed deletion.
 */
export async function acceptPreviewBuildInputDeleteReceipt(input: {
  jobId: string;
  commandToken: string;
  receiptToken: string;
  buildJobPrivateKeyPem: string | undefined;
  now?: Date;
}): Promise<PreviewArtifactGcAcceptanceResult> {
  const now = input.now ?? new Date();
  if (
    !UUID_PATTERN.test(input.jobId) ||
    !input.commandToken ||
    input.commandToken.length > 8_192 ||
    !input.receiptToken ||
    input.receiptToken.length > 8_192 ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactGcAcceptanceError(
      "PREVIEW_ARTIFACT_GC_ACCEPTANCE_INVALID",
    );
  }

  try {
    const serverPublicKeyPem = previewArtifactDeleteCommandPublicKeyPem(
      input.buildJobPrivateKeyPem,
    );
    let command: ReturnType<typeof verifyPreviewArtifactDeleteCommand>;
    try {
      const completedAtHint =
        previewArtifactDeleteReceiptCompletedAtHint(input.receiptToken);
      command = verifyPreviewArtifactDeleteCommand({
        token: input.commandToken,
        publicKeyPem: serverPublicKeyPem,
        now: completedAtHint,
      });
    } catch {
      throw new PreviewArtifactGcAcceptanceError(
        "PREVIEW_ARTIFACT_GC_ACCEPTANCE_INVALID",
      );
    }

    if (command.jobId !== input.jobId) {
      throw new PreviewArtifactGcAcceptanceError(
        "PREVIEW_ARTIFACT_GC_ACCEPTANCE_CONFLICT",
      );
    }

    return await db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(eq(previewBuildJobsTable.jobId, input.jobId))
        .limit(1);
      if (!snapshot) {
        throw new PreviewArtifactGcAcceptanceError(
          "PREVIEW_ARTIFACT_GC_ACCEPTANCE_CONFLICT",
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
        .where(eq(previewAgentNodesTable.nodeId, command.nodeId))
        .for("update")
        .limit(1);

      if (!job || !node || !node.publicKeyPem) {
        throw new PreviewArtifactGcAcceptanceError(
          "PREVIEW_ARTIFACT_GC_ACCEPTANCE_CONFLICT",
        );
      }

      if (
        !previewAgentOwnsBuildArtifact(
          node,
          { nodeId: command.nodeId, keyVersion: command.keyVersion },
          job,
        ) ||
        !previewBuildJobHasGcArtifact(job) ||
        !commandMatchesJob(command, job) ||
        (job.inputArtifactGcState !== "deleting" &&
          job.inputArtifactGcState !== "deleted")
      ) {
        throw new PreviewArtifactGcAcceptanceError(
          "PREVIEW_ARTIFACT_GC_ACCEPTANCE_CONFLICT",
        );
      }

      let receipt;
      try {
        receipt = verifyPreviewArtifactDeleteReceipt({
          token: input.receiptToken,
          publicKeyPem: node.publicKeyPem,
          command,
          now,
        });
      } catch {
        throw new PreviewArtifactGcAcceptanceError(
          "PREVIEW_ARTIFACT_GC_ACCEPTANCE_INVALID",
        );
      }
      if (
        receipt.commandId !== command.commandId ||
        receipt.commandFingerprint !==
          previewArtifactDeleteCommandFingerprint(command) ||
        receipt.nodeId !== command.nodeId ||
        receipt.keyVersion !== command.keyVersion
      ) {
        throw new PreviewArtifactGcAcceptanceError(
          "PREVIEW_ARTIFACT_GC_ACCEPTANCE_INVALID",
        );
      }

      if (job.inputArtifactGcState === "deleted") {
        return { job, alreadyAccepted: true };
      }

      const [updated] = await tx
        .update(previewBuildJobsTable)
        .set({
          inputArtifactGcState: "deleted",
          // Keep the claim timestamp as the deletion identity. A later worker
          // must not be able to turn an old receipt into the new lease.
          inputArtifactGcMarkedAt: new Date(command.gcLeaseAt),
          updatedAt: now,
          stateVersion: sql<number>`${previewBuildJobsTable.stateVersion} + 1`,
        })
        .where(
          and(
            eq(previewBuildJobsTable.jobId, job.jobId),
            eq(previewBuildJobsTable.stateVersion, job.stateVersion),
            eq(previewBuildJobsTable.inputArtifactGcState, "deleting"),
            eq(
              previewBuildJobsTable.inputArtifactGcMarkedAt,
              new Date(command.gcLeaseAt),
            ),
            eq(previewBuildJobsTable.inputArtifactOwnerNodeId, command.nodeId),
            eq(
              previewBuildJobsTable.inputArtifactOwnerKeyVersion,
              command.keyVersion,
            ),
            eq(previewBuildJobsTable.inputArtifactRefId, command.artifactRefId),
            eq(previewBuildJobsTable.archiveDigest, command.artifactDigest),
          ),
        )
        .returning();
      if (!updated) {
        throw new PreviewArtifactGcAcceptanceError(
          "PREVIEW_ARTIFACT_GC_ACCEPTANCE_CONFLICT",
        );
      }
      return { job: updated, alreadyAccepted: false };
    });
  } catch (error) {
    if (error instanceof PreviewArtifactGcAcceptanceError) throw error;
    throw new PreviewArtifactGcAcceptanceError(
      "PREVIEW_ARTIFACT_GC_ACCEPTANCE_UNAVAILABLE",
    );
  }
}
