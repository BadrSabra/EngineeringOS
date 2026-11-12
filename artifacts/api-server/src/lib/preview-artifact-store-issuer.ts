import { and, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  db,
  previewAgentNodesTable,
  previewBuildJobsTable,
  projectsTable,
} from "@workspace/db";
import { previewAgentPublicKeyFingerprint } from "./preview-agent-pairing-crypto.js";
import {
  previewBuildArtifactRefId,
  previewArtifactStoreCommandId,
} from "./preview-artifact-reference.js";
import { lockPreviewArtifactDigest } from "./preview-artifact-db-lock.js";
import {
  previewArtifactStoreCommandFingerprint,
  signPreviewArtifactStoreCommand,
  verifyPreviewArtifactStorePollProof,
  PreviewArtifactStorePollProofError,
  type PreviewArtifactStoreCommandClaims,
  type PreviewArtifactStorePollProofClaims,
} from "./preview-artifact-store-command.js";
import {
  previewArtifactStoreCandidateIsCurrent,
  previewArtifactStoreCommandMatchesJob,
} from "./preview-artifact-store-acceptance.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_TTL_MS = 30_000;

export class PreviewArtifactStoreCommandIssueError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_INVALID"
      | "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT"
      | "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_UNAVAILABLE",
  ) {
    super("Preview artifact store command is unavailable.");
    this.name = "PreviewArtifactStoreCommandIssueError";
  }
}

export type PreviewArtifactStoreCommandIssue = {
  commandId: string;
  commandFingerprint: string;
  expiresAt: Date;
  commandToken: string;
};

function hasRegisteredOwner(
  node: typeof previewAgentNodesTable.$inferSelect | undefined,
  proof: PreviewArtifactStorePollProofClaims,
  job: {
    projectId: string;
    userId: string;
    inputArtifactStoreId: string | null;
    inputArtifactOwnerNodeId: string | null;
    inputArtifactOwnerKeyVersion: number | null;
  },
): boolean {
  if (
    !node ||
    node.status !== "active" ||
    !node.publicKeyPem ||
    !node.publicKeyFingerprint ||
    node.nodeId !== proof.nodeId ||
    node.keyVersion !== proof.keyVersion ||
    node.storeId !== job.inputArtifactStoreId ||
    node.nodeId !== job.inputArtifactOwnerNodeId ||
    node.keyVersion !== job.inputArtifactOwnerKeyVersion ||
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

function createClaims(input: {
  job: typeof previewBuildJobsTable.$inferSelect;
  proof: PreviewArtifactStorePollProofClaims;
  now: Date;
}): PreviewArtifactStoreCommandClaims {
  const { job, proof, now } = input;
  if (
    !job.inputArtifactStoreId ||
    !job.inputArtifactRefId ||
    !job.inputArtifactSizeBytes ||
    !job.inputArtifactManifestDigest ||
    !job.inputArtifactRetentionPolicy
  ) {
    throw new PreviewArtifactStoreCommandIssueError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT",
    );
  }
  return {
    version: 1,
    action: "store-artifact",
    commandId: previewArtifactStoreCommandId(job.jobId),
    nodeId: proof.nodeId,
    keyVersion: proof.keyVersion,
    storeId: job.inputArtifactStoreId,
    artifactRefId: previewBuildArtifactRefId(job.jobId, "input"),
    jobId: job.jobId,
    projectId: job.projectId,
    proposalId: job.proposalId,
    operationId: job.operationId,
    proposalRevision: job.proposalRevision,
    candidateRevision: job.candidateRevision,
    changeSetHash: job.changeSetHash,
    artifactKind: "preview-build-input",
    sourceDigest: job.sourceDigest,
    artifactDigest: job.archiveDigest,
    sizeBytes: job.inputArtifactSizeBytes,
    manifestDigest: job.inputArtifactManifestDigest,
    retentionPolicy:
      job.inputArtifactRetentionPolicy as "preview-build-input-24h-v1",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + COMMAND_TTL_MS).toISOString(),
  };
}

/**
 * Issue the deterministic storage command only after a paired Agent proves
 * possession of its registered key and the Job still matches its Candidate.
 * Repeated polls are safe: semantic command identity is stable and the Agent's
 * CAS write is expected to be idempotent.
 */
export async function issuePreviewBuildInputStoreCommand(input: {
  jobId: string;
  proof: unknown;
  signature: string;
  buildJobPrivateKeyPem: string | undefined;
  now?: Date;
}): Promise<PreviewArtifactStoreCommandIssue> {
  const now = input.now ?? new Date();
  if (
    !UUID_PATTERN.test(input.jobId) ||
    !input.proof ||
    typeof input.proof !== "object" ||
    Array.isArray(input.proof) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactStoreCommandIssueError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_INVALID",
    );
  }

  try {
    const proofRecord = input.proof as Record<string, unknown>;
    if (
      typeof proofRecord.nodeId !== "string" ||
      !UUID_PATTERN.test(proofRecord.nodeId)
    ) {
      throw new PreviewArtifactStoreCommandIssueError(
        "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_INVALID",
      );
    }
    const [initialNode] = await db
      .select()
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.nodeId, proofRecord.nodeId))
      .limit(1);
    if (
      !initialNode?.publicKeyPem ||
      initialNode.status !== "active" ||
      !initialNode.publicKeyFingerprint
    ) {
      throw new PreviewArtifactStoreCommandIssueError(
        "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT",
      );
    }
    const proof = verifyPreviewArtifactStorePollProof({
      proof: input.proof,
      signature: input.signature,
      publicKeyPem: initialNode.publicKeyPem,
      now,
    });
    if (proof.jobId !== input.jobId) {
      throw new PreviewArtifactStoreCommandIssueError(
        "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_INVALID",
      );
    }

    return await db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(previewBuildJobsTable)
        .where(eq(previewBuildJobsTable.jobId, input.jobId))
        .limit(1);
      if (!snapshot) {
        throw new PreviewArtifactStoreCommandIssueError(
          "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT",
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
      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, proof.nodeId))
        .for("update")
        .limit(1);

      if (
        !job ||
        job.archiveDigest !== snapshot.archiveDigest ||
        job.inputArtifactProvider !== "local" ||
        job.status !== "queued" ||
        job.inputArtifactReadyAt !== null ||
        job.inputArtifactGcState !== "active" ||
        job.tokenExpiresAt.getTime() <= now.getTime() ||
        !hasRegisteredOwner(node, proof, job) ||
        !previewArtifactStoreCandidateIsCurrent(candidate ?? null, job)
      ) {
        throw new PreviewArtifactStoreCommandIssueError(
          "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT",
        );
      }

      const command = createClaims({ job, proof, now });
      const commandFingerprint =
        previewArtifactStoreCommandFingerprint(command);
      if (
        !previewArtifactStoreCommandMatchesJob(command, job) ||
        commandFingerprint !== job.inputArtifactStoreCommandFingerprint
      ) {
        throw new PreviewArtifactStoreCommandIssueError(
          "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_CONFLICT",
        );
      }
      const expiresAt = new Date(command.expiresAt);
      const commandToken = signPreviewArtifactStoreCommand({
        command,
        privateKeyPem: input.buildJobPrivateKeyPem,
        now,
      });
      return {
        commandId: command.commandId,
        commandFingerprint,
        expiresAt,
        commandToken,
      };
    });
  } catch (error) {
    if (error instanceof PreviewArtifactStoreCommandIssueError) throw error;
    if (error instanceof PreviewArtifactStorePollProofError) {
      throw new PreviewArtifactStoreCommandIssueError(
        "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_INVALID",
      );
    }
    throw new PreviewArtifactStoreCommandIssueError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_ISSUE_UNAVAILABLE",
    );
  }
}
