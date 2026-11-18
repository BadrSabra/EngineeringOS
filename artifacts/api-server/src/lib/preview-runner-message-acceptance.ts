import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  db,
  previewAgentNodesTable,
  previewBuildJobsTable,
  previewSessionsTable,
  projectsTable,
} from "@workspace/db";
import {
  PreviewRunnerMessageError,
  verifyPreviewRunnerMessageV1,
  type PreviewRunnerMessageV1,
} from "@workspace/preview-runner-contract";
import { verifyPreviewAgentCapabilityReport } from "./preview-agent-capability.js";
import { previewRunnerQualificationRegistry } from "./preview-runner-qualification.js";
import { previewRunnerRuntimeProfileRegistry } from "./preview-runner-runtime-profile.js";

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_TOKEN_LENGTH = 16_384;

export class PreviewRunnerMessageAcceptanceError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_RUNNER_MESSAGE_INVALID"
      | "PREVIEW_RUNNER_MESSAGE_UNQUALIFIED"
      | "PREVIEW_RUNNER_MESSAGE_CONFLICT"
      | "PREVIEW_RUNNER_MESSAGE_UNAVAILABLE",
  ) {
    super("Preview Runner message is invalid or unavailable.");
    this.name = "PreviewRunnerMessageAcceptanceError";
  }
}

export type PreviewRunnerMessageAcceptance = {
  sessionId: string;
  stateVersion: number;
  action: "start" | "observe" | "stop";
  messageType: PreviewRunnerMessageV1["messageType"];
  alreadyAccepted: boolean;
  observedState?: string;
};

export function projectAcceptedRunnerMessage(input: {
  action: "start" | "observe" | "stop";
  message: PreviewRunnerMessageV1;
  currentExecutionRef: string | null;
}): {
  executionRef: string | null;
  stateVersionIncrement: 0 | 1;
  projection: Record<string, unknown>;
} {
  const { action, message, currentExecutionRef } = input;
  let executionRef = currentExecutionRef;
  let stateVersionIncrement: 0 | 1 = 1;

  if (message.messageType === "start_ack") {
    if (
      action !== "start" ||
      currentExecutionRef !== null ||
      (message.status === "outcome_unknown" && message.executionRef !== null) ||
      (message.status !== "outcome_unknown" && !message.executionRef)
    ) {
      throw new PreviewRunnerMessageAcceptanceError(
        "PREVIEW_RUNNER_MESSAGE_INVALID",
      );
    }
    executionRef = message.executionRef;
    if (message.status === "outcome_unknown") stateVersionIncrement = 0;
  } else if (
    !currentExecutionRef ||
    message.executionRef !== currentExecutionRef ||
    (message.messageType === "observation" && action !== "observe") ||
    (message.messageType === "stop_ack" && action !== "stop")
  ) {
    throw new PreviewRunnerMessageAcceptanceError(
      "PREVIEW_RUNNER_MESSAGE_CONFLICT",
    );
  }

  return {
    executionRef,
    stateVersionIncrement,
    projection: { ...message },
  };
}

function messageDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function currentAction(
  session: typeof previewSessionsTable.$inferSelect,
): "start" | "observe" | "stop" | undefined {
  if (session.status === "starting") {
    return session.executionRef ? "observe" : "start";
  }
  if (session.status === "ready") return "observe";
  if (session.status === "stopping") return "stop";
  return undefined;
}

function storedProjectionMessageType(
  projection: Record<string, unknown> | null,
): PreviewRunnerMessageV1["messageType"] | undefined {
  const value = projection?.messageType;
  return value === "start_ack" ||
    value === "observation" ||
    value === "stop_ack"
    ? value
    : undefined;
}

function actionForMessageType(
  messageType: PreviewRunnerMessageV1["messageType"] | undefined,
): "start" | "observe" | "stop" | undefined {
  if (messageType === "start_ack") return "start";
  if (messageType === "observation") return "observe";
  if (messageType === "stop_ack") return "stop";
  return undefined;
}

function currentCandidateMatches(
  session: typeof previewSessionsTable.$inferSelect,
  candidate:
    | {
        id: string;
        projectId: string;
        ownerId: string;
        status: string;
        lifecycle: string;
        revision: number;
        operationId: string | null;
        baseTreeHash: string | null;
        candidateTreeHash: string | null;
        changeSetHash: string | null;
      }
    | undefined,
): candidate is NonNullable<typeof candidate> {
  return Boolean(
    candidate &&
      candidate.id === session.proposalId &&
      candidate.ownerId === session.userId &&
      candidate.status === "pending" &&
      (candidate.lifecycle === "isolated" ||
        candidate.lifecycle === "validated") &&
      candidate.revision === session.proposalRevision &&
      candidate.candidateTreeHash === session.candidateRevision &&
      candidate.changeSetHash === session.changeSetHash &&
      candidate.operationId &&
      candidate.baseTreeHash &&
      DIGEST_PATTERN.test(candidate.baseTreeHash),
  );
}

function isCurrentVerifiedBuild(
  session: typeof previewSessionsTable.$inferSelect,
  candidate: NonNullable<Parameters<typeof currentCandidateMatches>[1]>,
  job: typeof previewBuildJobsTable.$inferSelect | undefined,
): job is typeof previewBuildJobsTable.$inferSelect {
  return Boolean(
    job &&
      session.buildJobId === job.jobId &&
      session.buildReceiptId &&
      session.buildReceiptId === job.buildReceiptId &&
      job.projectId === candidate.projectId &&
      job.proposalId === candidate.id &&
      job.userId === session.userId &&
      job.operationId === candidate.operationId &&
      job.proposalRevision === candidate.revision &&
      job.candidateRevision === session.candidateRevision &&
      job.changeSetHash === session.changeSetHash &&
      job.status === "verified" &&
      job.outputArtifactGcState === "active" &&
      job.outputArtifactKey === session.buildOutputArtifactKey &&
      job.outputDigest === session.buildOutputDigest &&
      DIGEST_PATTERN.test(job.outputDigest ?? ""),
  );
}

export async function acceptPreviewRunnerMessage(input: {
  sessionId: string;
  token: string;
  now?: Date;
}): Promise<PreviewRunnerMessageAcceptance> {
  const now = input.now ?? new Date();
  if (
    !SESSION_ID_PATTERN.test(input.sessionId) ||
    typeof input.token !== "string" ||
    input.token.length === 0 ||
    input.token.length > MAX_TOKEN_LENGTH ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewRunnerMessageAcceptanceError(
      "PREVIEW_RUNNER_MESSAGE_INVALID",
    );
  }

  const incomingDigest = messageDigest(input.token);
  try {
    return await db.transaction(async (tx) => {
      // Read only to discover lock identities. The row is reloaded and checked
      // under lock after acquiring Candidate and Build locks in admission order.
      const [identity] = await tx
        .select()
        .from(previewSessionsTable)
        .where(eq(previewSessionsTable.id, input.sessionId))
        .limit(1);
      if (!identity) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_INVALID",
        );
      }

      const [candidateRow] = await tx
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
      if (!currentCandidateMatches(identity, candidateRow)) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_CONFLICT",
        );
      }

      const [buildJob] = identity.buildJobId
        ? await tx
            .select()
            .from(previewBuildJobsTable)
            .where(eq(previewBuildJobsTable.jobId, identity.buildJobId))
            .for("update")
            .limit(1)
        : [];
      if (!isCurrentVerifiedBuild(identity, candidateRow, buildJob)) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_CONFLICT",
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
        session.stateVersion !== identity.stateVersion ||
        session.executionGeneration !== identity.executionGeneration ||
        session.fencingGeneration !== identity.fencingGeneration ||
        !currentCandidateMatches(session, candidateRow) ||
        !isCurrentVerifiedBuild(session, candidateRow, buildJob)
      ) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_CONFLICT",
        );
      }

      if (
        session.executionProvider !== "local_agent" ||
        session.taskDefinitionArn !== null ||
        session.runnerTaskArn !== null ||
        !session.runnerNodeId ||
        !session.runnerKeyVersion ||
        !session.runtimeProfileId ||
        !session.runtimeProfileDigest ||
        !session.channelRef ||
        !session.buildReceiptId ||
        !session.buildOutputDigest ||
        session.expiresAt <= now ||
        !session.runnerCommandId
      ) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_INVALID",
        );
      }

      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, session.runnerNodeId))
        .for("update")
        .limit(1);
      if (
        !node ||
        node.status !== "active" ||
        node.projectId !== candidateRow.projectId ||
        node.userId !== session.userId ||
        node.keyVersion !== session.runnerKeyVersion ||
        !node.capabilityReportToken ||
        !node.capabilityExpiresAt ||
        node.capabilityExpiresAt <= now
      ) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_INVALID",
        );
      }

      const profileRecord = previewRunnerRuntimeProfileRegistry.get(
        session.runtimeProfileId,
      );
      if (
        !profileRecord ||
        profileRecord.digest !== session.runtimeProfileDigest.toLowerCase() ||
        profileRecord.profile.runtimeImageDigest !== session.imageDigest
      ) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_UNQUALIFIED",
        );
      }
      const qualification = previewRunnerQualificationRegistry.get(
        profileRecord.profile.qualificationRecordId,
      );
      if (
        !qualification ||
        qualification.runtimeProfileDigest !== profileRecord.digest ||
        qualification.isolationClass !==
          profileRecord.profile.requiredIsolationClass
      ) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_UNQUALIFIED",
        );
      }

      try {
        verifyPreviewAgentCapabilityReport({
          node,
          qualification,
          token: node.capabilityReportToken,
          now,
        });
      } catch {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_INVALID",
        );
      }

      // Exact retries are answered from the durable accepted digest, even if
      // the signed message's short TTL has elapsed. They never mutate state.
      const storedType = storedProjectionMessageType(
        session.runnerMessageProjection,
      );
      const storedAction = actionForMessageType(storedType);
      if (
        session.runnerMessageId &&
        session.runnerMessageDigest === incomingDigest &&
        session.runnerMessageProjection?.commandId ===
          session.runnerCommandId &&
        session.runnerMessageProjection.messageId ===
          session.runnerMessageId &&
        storedType &&
        storedAction
      ) {
        return {
          sessionId: session.id,
          stateVersion: session.stateVersion,
          action: storedAction,
          messageType: storedType,
          alreadyAccepted: true,
          ...(typeof session.runnerMessageProjection.state === "string"
            ? { observedState: session.runnerMessageProjection.state }
            : {}),
        };
      }

      const action = currentAction(session);
      if (
        !action ||
        !session.runnerLeaseOwner ||
        !session.runnerLeaseExpiresAt ||
        session.runnerLeaseExpiresAt <= now
      ) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_CONFLICT",
        );
      }

      const expected = {
        action,
        commandId: session.runnerCommandId,
        // The command identity is also the idempotency identity. Both are
        // persisted on the existing Session row and remain stable on retries.
        idempotencyKey: session.runnerCommandId,
        channelRef: session.channelRef,
        nodeId: node.nodeId,
        keyId: node.publicKeyFingerprint ?? "",
        sessionId: session.id,
        stateVersion: session.stateVersion,
        executionGeneration: session.executionGeneration,
        fencingGeneration: session.fencingGeneration,
        projectId: candidateRow.projectId,
        proposalId: candidateRow.id,
        operationId: candidateRow.operationId!,
        proposalRevision: candidateRow.revision,
        baseRevision: candidateRow.baseTreeHash!,
        candidateRevision: candidateRow.candidateTreeHash!,
        changeSetHash: candidateRow.changeSetHash!,
        buildReceiptId: session.buildReceiptId,
        runtimeProfileDigest: profileRecord.digest,
        artifactDigest: session.buildOutputDigest,
        runtimeImageDigest: profileRecord.profile.runtimeImageDigest,
        launcherDigest: profileRecord.profile.launcherDigest,
        filesystemPolicyDigest:
          profileRecord.profile.filesystemPolicyDigest,
        networkPolicyDigest: profileRecord.profile.networkPolicyDigest,
        resourcePolicyDigest: profileRecord.profile.resourcePolicyDigest,
      } as const;

      let message: PreviewRunnerMessageV1;
      try {
        message = verifyPreviewRunnerMessageV1({
          token: input.token,
          publicKeyPem: node.publicKeyPem ?? undefined,
          expected,
          now,
        });
      } catch (error) {
        if (error instanceof PreviewRunnerMessageError) {
          throw new PreviewRunnerMessageAcceptanceError(
            "PREVIEW_RUNNER_MESSAGE_INVALID",
          );
        }
        throw error;
      }

      const update = projectAcceptedRunnerMessage({
        action,
        message,
        currentExecutionRef: session.executionRef,
      });
      const [updated] = await tx
        .update(previewSessionsTable)
        .set({
          executionRef: update.executionRef,
          runnerMessageId: message.messageId,
          runnerMessageDigest: incomingDigest,
          runnerMessageProjection: update.projection,
          stateVersion: session.stateVersion + update.stateVersionIncrement,
          runnerLeaseOwner: null,
          runnerLeaseExpiresAt: null,
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
            eq(
              previewSessionsTable.fencingGeneration,
              session.fencingGeneration,
            ),
            eq(previewSessionsTable.runnerCommandId, session.runnerCommandId),
            eq(previewSessionsTable.runnerNodeId, node.nodeId),
            eq(previewSessionsTable.runnerKeyVersion, node.keyVersion),
            eq(previewSessionsTable.runnerLeaseOwner, session.runnerLeaseOwner),
            eq(
              previewSessionsTable.runnerLeaseExpiresAt,
              session.runnerLeaseExpiresAt,
            ),
            gt(previewSessionsTable.expiresAt, now),
          ),
        )
        .returning({
          id: previewSessionsTable.id,
          stateVersion: previewSessionsTable.stateVersion,
        });
      if (!updated) {
        throw new PreviewRunnerMessageAcceptanceError(
          "PREVIEW_RUNNER_MESSAGE_CONFLICT",
        );
      }

      return {
        sessionId: updated.id,
        stateVersion: updated.stateVersion,
        action,
        messageType: message.messageType,
        alreadyAccepted: false,
        ...(message.messageType === "observation"
          ? { observedState: message.state }
          : {}),
      };
    });
  } catch (error) {
    if (error instanceof PreviewRunnerMessageAcceptanceError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new PreviewRunnerMessageAcceptanceError(
        "PREVIEW_RUNNER_MESSAGE_CONFLICT",
      );
    }
    throw new PreviewRunnerMessageAcceptanceError(
      "PREVIEW_RUNNER_MESSAGE_UNAVAILABLE",
    );
  }
}
