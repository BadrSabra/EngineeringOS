import {
  and,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  aiChangeProposalsTable,
  db,
  previewAgentNodesTable,
  previewBuildJobsTable,
  projectsTable,
  type PreviewBuildJob,
} from "@workspace/db";
import { previewAgentPublicKeyFingerprint } from "./preview-agent-pairing-crypto.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";
import { lockPreviewArtifactDigest } from "./preview-artifact-db-lock.js";
import {
  isVerifiedPreviewArtifactStoreReceipt,
  previewArtifactStoreCommandFingerprint,
  previewArtifactStoreCommandPublicKeyPem,
  verifyPreviewArtifactStoreCommand,
  verifyPreviewArtifactStoreReceipt,
  type PreviewArtifactStoreCommandClaims,
} from "./preview-artifact-store-command.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PreviewArtifactStoreAcceptanceError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_INVALID"
      | "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT"
      | "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_UNAVAILABLE",
  ) {
    super("Preview artifact ownership receipt is invalid or unavailable.");
    this.name = "PreviewArtifactStoreAcceptanceError";
  }
}

export type PreviewArtifactStoreAcceptanceResult = {
  job: PreviewBuildJob;
  alreadyAccepted: boolean;
};

export function previewArtifactStoreCandidateIsCurrent(
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
      candidate.operationId === job.operationId &&
      candidate.status === "pending" &&
      (candidate.lifecycle === "isolated" ||
        candidate.lifecycle === "validated") &&
      candidate.revision === job.proposalRevision &&
      candidate.candidateTreeHash === job.candidateRevision &&
      candidate.changeSetHash === job.changeSetHash &&
      candidate.workspaceRoot,
  );
}

export function previewArtifactStoreCommandMatchesJob(
  command: PreviewArtifactStoreCommandClaims,
  job: PreviewBuildJob,
): boolean {
  return (
    command.jobId === job.jobId &&
    command.projectId === job.projectId &&
    command.proposalId === job.proposalId &&
    command.operationId === job.operationId &&
    command.proposalRevision === job.proposalRevision &&
    command.candidateRevision === job.candidateRevision &&
    command.changeSetHash === job.changeSetHash &&
    command.sourceDigest === job.sourceDigest &&
    command.artifactDigest === job.archiveDigest &&
    command.artifactRefId === previewBuildArtifactRefId(job.jobId, "input") &&
    command.storeId === job.inputArtifactStoreId &&
    command.artifactRefId === job.inputArtifactRefId &&
    command.sizeBytes === job.inputArtifactSizeBytes &&
    command.manifestDigest === job.inputArtifactManifestDigest &&
    command.retentionPolicy === job.inputArtifactRetentionPolicy &&
    command.nodeId === job.inputArtifactOwnerNodeId &&
    command.keyVersion === job.inputArtifactOwnerKeyVersion &&
    previewArtifactStoreCommandFingerprint(command) ===
      job.inputArtifactStoreCommandFingerprint
  );
}

function agentOwnsCommand(
  node: typeof previewAgentNodesTable.$inferSelect | undefined,
  job: PreviewBuildJob,
  command: ReturnType<typeof verifyPreviewArtifactStoreCommand>,
): boolean {
  if (
    !node ||
    node.status !== "active" ||
    !node.publicKeyPem ||
    !node.publicKeyFingerprint ||
    node.nodeId !== command.nodeId ||
    node.keyVersion !== command.keyVersion ||
    node.storeId !== command.storeId ||
    node.projectId !== job.projectId ||
    node.userId !== job.userId
  ) {
    return false;
  }
  try {
    return (
      previewAgentPublicKeyFingerprint(node.publicKeyPem) ===
      node.publicKeyFingerprint
    );
  } catch {
    return false;
  }
}

function receiptIdentity(
  command: ReturnType<typeof verifyPreviewArtifactStoreCommand>,
  receipt: ReturnType<typeof verifyPreviewArtifactStoreReceipt>,
): boolean {
  return (
    receipt.commandId === command.commandId &&
    receipt.commandFingerprint ===
      previewArtifactStoreCommandFingerprint(command) &&
    receipt.nodeId === command.nodeId &&
    receipt.keyVersion === command.keyVersion &&
    receipt.storeId === command.storeId &&
    receipt.artifactRefId === command.artifactRefId &&
    receipt.artifactDigest === command.artifactDigest &&
    receipt.sizeBytes === command.sizeBytes &&
    receipt.manifestDigest === command.manifestDigest
  );
}

function receiptFingerprint(token: string): string {
  return createHash("sha256")
    .update("EngineeringOS Preview Artifact Store Receipt Token v1\n", "utf8")
    .update(token, "utf8")
    .digest("hex");
}

/**
 * Accept a Local Agent's signed input-artifact receipt and bind it to the
 * pre-existing Job row. This does not create a Job, dispatch a Builder, or
 * enable local storage admission.
 */
export async function acceptPreviewBuildInputStoreReceipt(input: {
  jobId: string;
  commandToken: string;
  receiptToken: string;
  buildJobPrivateKeyPem: string | undefined;
  now?: Date;
}): Promise<PreviewArtifactStoreAcceptanceResult> {
  const now = input.now ?? new Date();
  if (
    !UUID_PATTERN.test(input.jobId) ||
    !input.commandToken ||
    input.commandToken.length > 8_192 ||
    !input.receiptToken ||
    input.receiptToken.length > 8_192 ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactStoreAcceptanceError(
      "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_INVALID",
    );
  }

  try {
    const serverPublicKeyPem = previewArtifactStoreCommandPublicKeyPem(
      input.buildJobPrivateKeyPem,
    );
    return await db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(eq(previewBuildJobsTable.jobId, input.jobId))
        .limit(1);
      if (!snapshot) {
        throw new PreviewArtifactStoreAcceptanceError(
          "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT",
        );
      }
      await lockPreviewArtifactDigest(tx, snapshot.archiveDigest);

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
          ),
        )
        .for("update");

      const [job] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(eq(previewBuildJobsTable.jobId, input.jobId))
        .for("update")
        .limit(1);
      if (!job || job.archiveDigest !== snapshot.archiveDigest) {
        throw new PreviewArtifactStoreAcceptanceError(
          "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT",
        );
      }

      let command: ReturnType<typeof verifyPreviewArtifactStoreCommand>;
      try {
        command = verifyPreviewArtifactStoreCommand({
          token: input.commandToken,
          publicKeyPem: serverPublicKeyPem,
          now,
        });
      } catch {
        throw new PreviewArtifactStoreAcceptanceError(
          "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_INVALID",
        );
      }

      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, command.nodeId))
        .for("update")
        .limit(1);
      const agentPublicKeyPem = node?.publicKeyPem;

      if (
        job.inputArtifactProvider !== "local" ||
        job.status !== "queued" ||
        job.inputArtifactGcState !== "active" ||
        job.tokenExpiresAt.getTime() <= now.getTime() ||
        !agentPublicKeyPem ||
        !previewArtifactStoreCommandMatchesJob(command, job) ||
        !agentOwnsCommand(node, job, command) ||
        !previewArtifactStoreCandidateIsCurrent(candidate ?? null, job)
      ) {
        throw new PreviewArtifactStoreAcceptanceError(
          "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT",
        );
      }

      let receipt;
      try {
        receipt = verifyPreviewArtifactStoreReceipt({
          token: input.receiptToken,
          publicKeyPem: agentPublicKeyPem,
          command,
          now,
        });
      } catch {
        throw new PreviewArtifactStoreAcceptanceError(
          "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_INVALID",
        );
      }
      if (
        !isVerifiedPreviewArtifactStoreReceipt(receipt) ||
        !receiptIdentity(command, receipt)
      ) {
        throw new PreviewArtifactStoreAcceptanceError(
          "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_INVALID",
        );
      }

      const acceptedReceiptFingerprint = receiptFingerprint(input.receiptToken);
      if (job.inputArtifactReadyAt) {
        if (
          job.inputArtifactStoreReceiptFingerprint !==
          acceptedReceiptFingerprint
        ) {
          throw new PreviewArtifactStoreAcceptanceError(
            "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT",
          );
        }
        return { job, alreadyAccepted: true };
      }

      const [updated] = await tx
        .update(previewBuildJobsTable)
        .set({
          inputArtifactReadyAt: now,
          inputArtifactStoreReceiptFingerprint:
            acceptedReceiptFingerprint,
          inputArtifactGcState: "active",
          inputArtifactGcMarkedAt: null,
          updatedAt: now,
          stateVersion: sql<number>`${previewBuildJobsTable.stateVersion} + 1`,
        })
        .where(
          and(
            eq(previewBuildJobsTable.jobId, job.jobId),
            eq(previewBuildJobsTable.status, "queued"),
            eq(previewBuildJobsTable.stateVersion, job.stateVersion),
            eq(previewBuildJobsTable.inputArtifactProvider, "local"),
            eq(previewBuildJobsTable.inputArtifactStoreId, command.storeId),
            eq(previewBuildJobsTable.inputArtifactRefId, command.artifactRefId),
            eq(
              previewBuildJobsTable.inputArtifactOwnerNodeId,
              command.nodeId,
            ),
            eq(
              previewBuildJobsTable.inputArtifactOwnerKeyVersion,
              command.keyVersion,
            ),
            eq(
              previewBuildJobsTable.inputArtifactStoreCommandFingerprint,
              previewArtifactStoreCommandFingerprint(command),
            ),
            eq(previewBuildJobsTable.archiveDigest, command.artifactDigest),
            eq(previewBuildJobsTable.inputArtifactGcState, "active"),
            isNull(previewBuildJobsTable.inputArtifactReadyAt),
            isNull(previewBuildJobsTable.inputArtifactStoreReceiptFingerprint),
          ),
        )
        .returning();
      if (!updated) {
        throw new PreviewArtifactStoreAcceptanceError(
          "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT",
        );
      }
      return { job: updated, alreadyAccepted: false };
    });
  } catch (error) {
    if (error instanceof PreviewArtifactStoreAcceptanceError) throw error;
    throw new PreviewArtifactStoreAcceptanceError(
      "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_UNAVAILABLE",
    );
  }
}
