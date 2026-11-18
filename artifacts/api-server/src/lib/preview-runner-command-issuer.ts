import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  db,
  previewAgentNodesTable,
  previewBuildJobsTable,
  previewSessionsTable,
  projectsTable,
} from "@workspace/db";
import {
  PreviewRunnerCommandError,
  previewRunnerCommandPublicKeyPem,
  signPreviewRunnerCommandV1,
  verifyPreviewRunnerPollProofV1,
  type PreviewRunnerCommandV1,
  type PreviewRunnerPollProofV1,
  type PreviewRunnerResourceLimitsV1,
} from "@workspace/preview-runner-contract";
import { previewAgentPublicKeyFingerprint } from "./preview-agent-pairing-crypto.js";
import { verifyPreviewAgentCapabilityReport } from "./preview-agent-capability.js";
import {
  currentPreviewRunnerBuildMatches,
  currentPreviewRunnerCandidateMatches,
} from "./preview-runner-message-acceptance.js";
import { previewRunnerQualificationRegistry } from "./preview-runner-qualification.js";
import { previewRunnerRuntimeProfileRegistry } from "./preview-runner-runtime-profile.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const COMMAND_TTL_MS = 30_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

// Conservative server-owned limits. A qualified profile still has to attest
// the matching resource policy digest before this command can be issued.
const RESOURCE_LIMITS: PreviewRunnerResourceLimitsV1 = Object.freeze({
  cpuMillicores: 1_000,
  memoryBytes: 512 * 1024 * 1024,
  scratchBytes: 256 * 1024 * 1024,
  pidLimit: 64,
  startupTimeoutMs: 30_000,
  idleTimeoutMs: 5 * 60_000,
  sessionTtlMs: 15 * 60_000,
});

function resourceLimitsForSession(
  session: typeof previewSessionsTable.$inferSelect,
  now: Date,
): PreviewRunnerResourceLimitsV1 {
  const remainingSessionMs = Math.floor(
    session.expiresAt.getTime() - now.getTime(),
  );
  if (remainingSessionMs < 1_000) {
    throw new PreviewRunnerCommandIssueError(
      "PREVIEW_RUNNER_COMMAND_CONFLICT",
    );
  }
  const sessionTtlMs = Math.min(
    RESOURCE_LIMITS.sessionTtlMs,
    remainingSessionMs,
  );
  return {
    ...RESOURCE_LIMITS,
    sessionTtlMs,
    idleTimeoutMs: Math.min(RESOURCE_LIMITS.idleTimeoutMs, sessionTtlMs),
    startupTimeoutMs: Math.min(
      RESOURCE_LIMITS.startupTimeoutMs,
      sessionTtlMs,
    ),
  };
}

export class PreviewRunnerCommandIssueError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_RUNNER_COMMAND_INVALID"
      | "PREVIEW_RUNNER_COMMAND_UNQUALIFIED"
      | "PREVIEW_RUNNER_COMMAND_CONFLICT"
      | "PREVIEW_RUNNER_COMMAND_UNAVAILABLE",
  ) {
    super("Preview Runner command is unavailable.");
    this.name = "PreviewRunnerCommandIssueError";
  }
}

export type PreviewRunnerCommandIssue = {
  commandId: string;
  fencingGeneration: number;
  expiresAt: Date;
  commandToken: string;
};

function pollProofDigest(
  proof: PreviewRunnerPollProofV1,
  signature: string,
): string {
  return createHash("sha256")
    .update("EngineeringOS Preview Runner Poll Proof Digest v1\n", "utf8")
    .update(signature, "utf8")
    .digest("hex");
}

function commandAction(
  session: typeof previewSessionsTable.$inferSelect,
): "start" | "observe" | undefined {
  if (session.status === "starting") {
    return session.executionRef ? "observe" : "start";
  }
  if (session.status === "ready" && session.executionRef) return "observe";
  // Stop is intentionally not issued until an authenticated, reason-bearing
  // stop transition exists; status alone is not enough to invent a reason.
  return undefined;
}

export function planPreviewRunnerLease(input: {
  action: "start" | "observe";
  now: Date;
  currentCommandId: string | null;
  currentFencingGeneration: number;
  currentLeaseOwner: string | null;
  currentLeaseProofDigest: string | null;
  currentLeaseExpiresAt: Date | null;
  requestedLeaseOwner: string;
  requestedProofDigest: string;
  acceptedMessageCommandId: string | null;
  acceptedMessageType: unknown;
  acceptedMessageStatus: unknown;
  nextCommandId?: string;
}): {
  commandId: string;
  fencingGeneration: number;
  alreadyLeased: boolean;
} {
  const activeLease =
    input.currentLeaseExpiresAt !== null &&
    input.currentLeaseExpiresAt > input.now;
  if (activeLease) {
    if (
      !input.currentCommandId ||
      input.currentLeaseOwner !== input.requestedLeaseOwner ||
      input.currentLeaseProofDigest !== input.requestedProofDigest
    ) {
      throw new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_CONFLICT",
      );
    }
    return {
      commandId: input.currentCommandId,
      fencingGeneration: input.currentFencingGeneration,
      alreadyLeased: true,
    };
  }

  const latestResponseBelongsToCommand =
    input.currentCommandId !== null &&
    input.acceptedMessageCommandId === input.currentCommandId;
  const unknownStartOutcome =
    input.action === "start" &&
    input.acceptedMessageType === "start_ack" &&
    input.acceptedMessageStatus === "outcome_unknown";
  const canRetryExistingCommand =
    input.currentCommandId !== null &&
    (!latestResponseBelongsToCommand || unknownStartOutcome);
  const fencingGeneration = input.currentFencingGeneration + 1;
  if (
    !Number.isSafeInteger(fencingGeneration) ||
    fencingGeneration > MAX_POSTGRES_INTEGER
  ) {
    throw new PreviewRunnerCommandIssueError(
      "PREVIEW_RUNNER_COMMAND_CONFLICT",
    );
  }
  return {
    commandId: canRetryExistingCommand
      ? input.currentCommandId!
      : (input.nextCommandId ?? randomUUID()),
    fencingGeneration,
    alreadyLeased: false,
  };
}

function signedCommandFor(input: {
  action: "start" | "observe";
  commandId: string;
  fencingGeneration: number;
  expiresAt: Date;
  node: typeof previewAgentNodesTable.$inferSelect;
  session: typeof previewSessionsTable.$inferSelect;
  candidate: {
    id: string;
    projectId: string;
    revision: number;
    operationId: string | null;
    baseTreeHash: string | null;
    candidateTreeHash: string | null;
    changeSetHash: string | null;
  };
  job: typeof previewBuildJobsTable.$inferSelect;
  profile: NonNullable<
    ReturnType<typeof previewRunnerRuntimeProfileRegistry.get>
  >;
  privateKeyPem: string;
  now: Date;
}): PreviewRunnerCommandIssue {
  const {
    action,
    commandId,
    fencingGeneration,
    expiresAt,
    node,
    session,
    candidate,
    job,
    profile,
    privateKeyPem,
    now,
  } = input;
  const shared = {
    protocolVersion: 1 as const,
    action,
    commandId,
    idempotencyKey: commandId,
    nodeId: node.nodeId,
    sessionId: session.id,
    stateVersion: session.stateVersion,
    executionGeneration: session.executionGeneration,
    fencingGeneration,
    projectId: candidate.projectId,
    proposalId: candidate.id,
    operationId: candidate.operationId!,
    proposalRevision: candidate.revision,
    baseRevision: candidate.baseTreeHash!,
    candidateRevision: candidate.candidateTreeHash!,
    changeSetHash: candidate.changeSetHash!,
    buildReceiptId: session.buildReceiptId!,
    artifactDigest: job.outputDigest!,
    runtimeProfileDigest: profile.digest,
    channelRef: session.channelRef!,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  let command: PreviewRunnerCommandV1;
  if (action === "start") {
    if (
      session.stateVersion !== 0 ||
      session.executionRef !== null ||
      !job.outputArtifactRefId ||
      !job.outputArtifactManifestDigest ||
      !job.outputArtifactSizeBytes ||
      !DIGEST_PATTERN.test(job.outputArtifactManifestDigest) ||
      !DIGEST_PATTERN.test(job.outputDigest ?? "")
    ) {
      throw new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_CONFLICT",
      );
    }
    command = {
      ...shared,
      action: "start",
      stateVersion: 0,
      artifactRef: {
        artifactId: job.outputArtifactRefId,
        digest: job.outputDigest!,
        manifestDigest: job.outputArtifactManifestDigest,
        sizeBytes: job.outputArtifactSizeBytes,
      },
      runtimeProfile: profile.profile,
      resourceLimits: resourceLimitsForSession(session, now),
    };
  } else {
    if (
      session.stateVersion < 1 ||
      !session.executionRef ||
      !/^exec_[A-Za-z0-9_-]{16,96}$/.test(session.executionRef)
    ) {
      throw new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_CONFLICT",
      );
    }
    command = {
      ...shared,
      action: "observe",
      stateVersion: session.stateVersion,
      executionRef: session.executionRef,
    };
  }

  return {
    commandId,
    fencingGeneration,
    expiresAt,
    commandToken: signPreviewRunnerCommandV1({
      command,
      privateKeyPem,
      now,
    }),
  };
}

export async function issuePreviewRunnerSessionCommand(input: {
  nodeId: string;
  sessionId: string;
  proof: unknown;
  signature: string;
  commandPrivateKeyPem: string | undefined;
  now?: Date;
}): Promise<PreviewRunnerCommandIssue | null> {
  const now = input.now ?? new Date();
  if (
    !UUID_PATTERN.test(input.nodeId) ||
    !UUID_PATTERN.test(input.sessionId) ||
    !Number.isFinite(now.getTime()) ||
    !input.proof ||
    typeof input.proof !== "object" ||
    Array.isArray(input.proof)
  ) {
    throw new PreviewRunnerCommandIssueError(
      "PREVIEW_RUNNER_COMMAND_INVALID",
    );
  }

  try {
    const proofInput = input.proof as Record<string, unknown>;
    if (
      proofInput.nodeId !== input.nodeId ||
      proofInput.sessionId !== input.sessionId
    ) {
      throw new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_INVALID",
      );
    }
    const [initialNode] = await db
      .select()
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.nodeId, input.nodeId))
      .limit(1);
    if (
      !initialNode?.publicKeyPem ||
      !initialNode.publicKeyFingerprint ||
      initialNode.status !== "active"
    ) {
      throw new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_CONFLICT",
      );
    }
    let proof: PreviewRunnerPollProofV1;
    try {
      proof = verifyPreviewRunnerPollProofV1({
        proof: input.proof,
        signature: input.signature,
        publicKeyPem: initialNode.publicKeyPem,
        now,
      });
    } catch (error) {
      if (error instanceof PreviewRunnerCommandError) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_INVALID",
        );
      }
      throw error;
    }
    if (
      proof.nodeId !== input.nodeId ||
      proof.sessionId !== input.sessionId ||
      proof.keyVersion !== initialNode.keyVersion
    ) {
      throw new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_INVALID",
      );
    }
    const proofDigest = pollProofDigest(proof, input.signature);

    return await db.transaction(async (tx) => {
      const [identity] = await tx
        .select()
        .from(previewSessionsTable)
        .where(eq(previewSessionsTable.id, input.sessionId))
        .limit(1);
      if (!identity || identity.runnerNodeId !== input.nodeId) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_CONFLICT",
        );
      }

      const [candidate] = await tx
        .select({
          id: aiChangeProposalsTable.id,
          projectId: aiChangeProposalsTable.projectId,
          ownerId: projectsTable.ownerId,
          status: aiChangeProposalsTable.status,
          lifecycle: aiChangeProposalsTable.lifecycle,
          revision: aiChangeProposalsTable.revision,
          operationId: aiChangeProposalsTable.operationId,
          baseTreeHash: aiChangeProposalsTable.baseTreeHash,
          candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
          changeSetHash: aiChangeProposalsTable.changeSetHash,
        })
        .from(aiChangeProposalsTable)
        .innerJoin(
          projectsTable,
          eq(aiChangeProposalsTable.projectId, projectsTable.id),
        )
        .where(eq(aiChangeProposalsTable.id, identity.proposalId))
        .for("update")
        .limit(1);
      if (!currentPreviewRunnerCandidateMatches(identity, candidate)) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_CONFLICT",
        );
      }

      const [job] = identity.buildJobId
        ? await tx
            .select()
            .from(previewBuildJobsTable)
            .where(eq(previewBuildJobsTable.jobId, identity.buildJobId))
            .for("update")
            .limit(1)
        : [];
      if (!currentPreviewRunnerBuildMatches(identity, candidate, job)) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_CONFLICT",
        );
      }

      const [session] = await tx
        .select()
        .from(previewSessionsTable)
        .where(eq(previewSessionsTable.id, input.sessionId))
        .for("update")
        .limit(1);
      if (
        !session ||
        session.proposalId !== identity.proposalId ||
        session.buildJobId !== identity.buildJobId ||
        session.runnerNodeId !== input.nodeId ||
        session.stateVersion !== identity.stateVersion ||
        session.executionGeneration !== identity.executionGeneration ||
        session.fencingGeneration !== identity.fencingGeneration ||
        !currentPreviewRunnerCandidateMatches(session, candidate) ||
        !currentPreviewRunnerBuildMatches(session, candidate, job)
      ) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_CONFLICT",
        );
      }

      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, input.nodeId))
        .for("update")
        .limit(1);
      let lockedProof: PreviewRunnerPollProofV1 | undefined;
      try {
        lockedProof = verifyPreviewRunnerPollProofV1({
          proof,
          signature: input.signature,
          publicKeyPem: node?.publicKeyPem ?? undefined,
          now,
        });
      } catch {
        lockedProof = undefined;
      }
      if (
        !node ||
        node.status !== "active" ||
        !node.publicKeyPem ||
        !node.publicKeyFingerprint ||
        node.projectId !== candidate.projectId ||
        node.userId !== session.userId ||
        node.keyVersion !== proof.keyVersion ||
        !lockedProof ||
        previewAgentPublicKeyFingerprint(node.publicKeyPem) !==
          node.publicKeyFingerprint ||
        job.outputArtifactProvider !== "local" ||
        !job.outputArtifactStoreId ||
        job.outputArtifactStoreId !== node.storeId ||
        !job.outputArtifactRefId ||
        !job.outputArtifactSizeBytes ||
        !job.outputArtifactManifestDigest ||
        job.outputArtifactGcState !== "active" ||
        session.executionProvider !== "local_agent" ||
        session.taskDefinitionArn !== null ||
        session.runnerTaskArn !== null ||
        !session.runtimeProfileId ||
        !session.runtimeProfileDigest ||
        !session.channelRef ||
        !session.buildReceiptId ||
        !session.buildOutputDigest ||
        session.expiresAt <= now
      ) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_CONFLICT",
        );
      }

      const profile = previewRunnerRuntimeProfileRegistry.get(
        session.runtimeProfileId,
      );
      if (
        !profile ||
        profile.digest !== session.runtimeProfileDigest.toLowerCase() ||
        profile.profile.runtimeImageDigest !== session.imageDigest
      ) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_UNQUALIFIED",
        );
      }
      const qualification = previewRunnerQualificationRegistry.get(
        profile.profile.qualificationRecordId,
      );
      if (
        !qualification ||
        qualification.runtimeProfileDigest !== profile.digest ||
        qualification.isolationClass !==
          profile.profile.requiredIsolationClass
      ) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_UNQUALIFIED",
        );
      }
      try {
        verifyPreviewAgentCapabilityReport({
          node,
          qualification,
          token: node.capabilityReportToken!,
          now,
        });
      } catch {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_UNQUALIFIED",
        );
      }

      const action = commandAction(session);
      if (!action) return null;
      if (action === "start" && session.stateVersion !== 0) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_CONFLICT",
        );
      }
      if (!input.commandPrivateKeyPem) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_UNAVAILABLE",
        );
      }

      const leaseUntil =
        session.runnerLeaseExpiresAt && session.runnerLeaseExpiresAt > now
          ? session.runnerLeaseExpiresAt
          : null;
      const messageProjection = session.runnerMessageProjection;
      const leasePlan = planPreviewRunnerLease({
        action,
        now,
        currentCommandId: session.runnerCommandId,
        currentFencingGeneration: session.fencingGeneration,
        currentLeaseOwner: session.runnerLeaseOwner,
        currentLeaseProofDigest: session.runnerLeaseProofDigest,
        currentLeaseExpiresAt: leaseUntil,
        requestedLeaseOwner: proof.leaseOwner,
        requestedProofDigest: proofDigest,
        acceptedMessageCommandId:
          typeof messageProjection?.commandId === "string"
            ? messageProjection.commandId
            : null,
        acceptedMessageType: messageProjection?.messageType,
        acceptedMessageStatus: messageProjection?.status,
        nextCommandId: randomUUID(),
      });
      const { commandId, fencingGeneration } = leasePlan;

      const proofExpiresAt =
        Date.parse(proof.issuedAt) + COMMAND_TTL_MS;
      const expiresAt = leasePlan.alreadyLeased
        ? leaseUntil!
        : new Date(
            Math.min(
              now.getTime() + COMMAND_TTL_MS,
              proofExpiresAt,
              session.expiresAt.getTime(),
            ),
          );
      if (expiresAt.getTime() <= now.getTime()) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_INVALID",
        );
      }

      const issued = signedCommandFor({
        action,
        commandId,
        fencingGeneration,
        expiresAt,
        node,
        session,
        candidate,
        job,
        profile,
        privateKeyPem: input.commandPrivateKeyPem,
        now,
      });

      if (leasePlan.alreadyLeased) return issued;

      const leasePredicates = [
        session.runnerLeaseOwner
          ? eq(
              previewSessionsTable.runnerLeaseOwner,
              session.runnerLeaseOwner,
            )
          : isNull(previewSessionsTable.runnerLeaseOwner),
        session.runnerLeaseProofDigest
          ? eq(
              previewSessionsTable.runnerLeaseProofDigest,
              session.runnerLeaseProofDigest,
            )
          : isNull(previewSessionsTable.runnerLeaseProofDigest),
        session.runnerLeaseExpiresAt
          ? eq(
              previewSessionsTable.runnerLeaseExpiresAt,
              session.runnerLeaseExpiresAt,
            )
          : isNull(previewSessionsTable.runnerLeaseExpiresAt),
        session.runnerCommandId
          ? eq(previewSessionsTable.runnerCommandId, session.runnerCommandId)
          : isNull(previewSessionsTable.runnerCommandId),
      ];
      const [updated] = await tx
        .update(previewSessionsTable)
        .set({
          runnerCommandId: commandId,
          fencingGeneration,
          runnerLeaseOwner: proof.leaseOwner,
          runnerLeaseProofDigest: proofDigest,
          runnerLeaseExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(previewSessionsTable.id, session.id),
            eq(previewSessionsTable.status, session.status),
            eq(previewSessionsTable.stateVersion, session.stateVersion),
            eq(
              previewSessionsTable.executionGeneration,
              session.executionGeneration,
            ),
            eq(previewSessionsTable.fencingGeneration, session.fencingGeneration),
            ...leasePredicates,
            gt(previewSessionsTable.expiresAt, now),
          ),
        )
        .returning({ id: previewSessionsTable.id });
      if (!updated) {
        throw new PreviewRunnerCommandIssueError(
          "PREVIEW_RUNNER_COMMAND_CONFLICT",
        );
      }
      return issued;
    });
  } catch (error) {
    if (error instanceof PreviewRunnerCommandIssueError) throw error;
    if (error instanceof PreviewRunnerCommandError) {
      throw new PreviewRunnerCommandIssueError(
        "PREVIEW_RUNNER_COMMAND_INVALID",
      );
    }
    throw new PreviewRunnerCommandIssueError(
      "PREVIEW_RUNNER_COMMAND_UNAVAILABLE",
    );
  }
}

export function getPreviewRunnerCommandPublicKey(
  privateKeyPem: string | undefined,
): string | undefined {
  if (!privateKeyPem) return undefined;
  try {
    return previewRunnerCommandPublicKeyPem(privateKeyPem);
  } catch {
    return undefined;
  }
}
