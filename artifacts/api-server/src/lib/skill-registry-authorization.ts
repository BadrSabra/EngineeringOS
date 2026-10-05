import { and, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiShadowReplaysTable,
  db,
} from "@workspace/db";
import { evaluateGoalDependencyState } from "./mission-runtime.js";
import { loadCanonicalProof } from "./proof-foundation.js";
import {
  parseStoredProposalEvidence,
  validateSkillCandidateAgainstCanonicalProof,
} from "./skill-candidate.js";
import {
  buildSkillShadowScore,
  parseShadowReplayRegistryReceipt,
  type ShadowReplayRegistryReceipt,
  type SkillShadowScore,
} from "./skill-registry.js";
import {
  assertCandidateWorkspaceIdentity,
  expectedShadowReplayOperationId,
} from "./shadow-replay.js";

type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SkillRegistryAuthorityGate =
  | {
      ok: true;
      proposal: typeof aiChangeProposalsTable.$inferSelect;
      replay: typeof aiShadowReplaysTable.$inferSelect;
      receipt: ShadowReplayRegistryReceipt;
      shadowScore: SkillShadowScore;
    }
  | { ok: false; reason: "identity" | "proof" | "paired-baseline" };

function readPlanRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const planRevision = (value as { planRevision?: unknown }).planRevision;
  if (!planRevision || typeof planRevision !== "object" || Array.isArray(planRevision)) {
    return undefined;
  }
  const hash = (planRevision as { hash?: unknown }).hash;
  return typeof hash === "string" && hash.trim() ? hash : undefined;
}

function readActivePlanRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const revision = (value as { activePlanRevision?: unknown }).activePlanRevision;
  return typeof revision === "string" && revision.trim() ? revision : undefined;
}

function readJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function lockCurrentAcceptanceEvidence(
  tx: MissionTransaction,
  acceptanceId: string,
  executionId: string,
  attempt: number,
): Promise<boolean> {
  const [acceptance] = await tx
    .select({
      executionId: aiExecutionAcceptancesTable.executionId,
      attempt: aiExecutionAcceptancesTable.attempt,
      evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
    })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.id, acceptanceId),
      eq(aiExecutionAcceptancesTable.executionId, executionId),
    ))
    .for("update")
    .limit(1);
  if (
    !acceptance
    || acceptance.attempt !== attempt
    || !acceptance.evidenceSnapshotId
  ) {
    return false;
  }
  const [evidence] = await tx
    .select({
      id: aiExecutionEvidenceSnapshotsTable.id,
      attempt: aiExecutionEvidenceSnapshotsTable.attempt,
    })
    .from(aiExecutionEvidenceSnapshotsTable)
    .where(eq(aiExecutionEvidenceSnapshotsTable.id, acceptance.evidenceSnapshotId))
    .for("update")
    .limit(1);
  return evidence?.attempt === attempt;
}

export async function validateSkillRegistryAuthority(
  tx: MissionTransaction,
  input: {
    projectId: string;
    proposalId: string;
    replayId: string;
    expectedCandidateId?: string;
    expectedSourceRevision?: string;
    expectedCandidateTreeHash?: string;
    expectedProofReceiptId?: string;
  },
): Promise<SkillRegistryAuthorityGate> {
  const [proposal] = await tx
    .select()
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, input.proposalId),
      eq(aiChangeProposalsTable.projectId, input.projectId),
    ))
    .for("update")
    .limit(1);
  const [replay] = await tx
    .select()
    .from(aiShadowReplaysTable)
    .where(and(
      eq(aiShadowReplaysTable.id, input.replayId),
      eq(aiShadowReplaysTable.projectId, input.projectId),
    ))
    .for("update")
    .limit(1);
  if (!proposal || !replay) return { ok: false, reason: "identity" };

  const skillCandidate = parseStoredProposalEvidence(
    (() => {
      try {
        return proposal.validationEvidence ? JSON.parse(proposal.validationEvidence) : null;
      } catch {
        return null;
      }
    })(),
  ).skillCandidate;
  const receipt = parseShadowReplayRegistryReceipt(replay.receipt);
  if (!skillCandidate || !receipt) return { ok: false, reason: "identity" };

  const candidateId = skillCandidate.candidateId;
  if (
    replay.status !== "completed"
    || replay.executionProfile !== "shadow-replay"
    || replay.proposalId !== proposal.id
    || replay.candidateId !== candidateId
    || (input.expectedCandidateId && candidateId !== input.expectedCandidateId)
    || (input.expectedSourceRevision && proposal.baseRevision !== input.expectedSourceRevision)
    || (
      input.expectedCandidateTreeHash
      && proposal.candidateTreeHash !== input.expectedCandidateTreeHash
    )
    || (
      input.expectedProofReceiptId
      && receipt.proof.receiptId !== input.expectedProofReceiptId
    )
    || !proposal.operationId
    || !proposal.baseRevision
    || !proposal.candidateTreeHash
    || !proposal.workspaceRoot
    || proposal.changeSetHash === undefined
    || !replay.changeSetHash
    || !proposal.changeSetHash
    || !replay.sourceWorkspaceRoot
    || replay.sourceWorkspaceRoot !== proposal.workspaceRoot
    || replay.operationId !== expectedShadowReplayOperationId(proposal.id, candidateId)
    || replay.changeSetHash !== proposal.changeSetHash
    || replay.sourceRevision !== proposal.baseRevision
    || replay.candidateTreeHash !== proposal.candidateTreeHash
    || skillCandidate.projectId !== proposal.projectId
    || skillCandidate.sourceRevision !== proposal.baseRevision
    || skillCandidate.candidateTreeHash !== proposal.candidateTreeHash
    || skillCandidate.changeSetHash !== proposal.changeSetHash
    || receipt.runId !== replay.id
    || receipt.replayId !== replay.id
    || receipt.replayExecutionId !== replay.executionId
    || receipt.operationId !== replay.operationId
    || receipt.changeSetHash !== proposal.changeSetHash
    || receipt.candidateId !== candidateId
    || receipt.projectId !== proposal.projectId
    || receipt.sourceRevision !== proposal.baseRevision
    || receipt.candidateTreeHash !== proposal.candidateTreeHash
    || receipt.attempt !== replay.attempt
    || receipt.preTreeHash !== proposal.candidateTreeHash
    || receipt.postTreeHash !== proposal.candidateTreeHash
    || replay.canonicalAcceptanceId !== skillCandidate.proof.receiptId
    || replay.replayCanonicalAcceptanceId !== receipt.proof.receiptId
    || receipt.proof.receiptId !== (input.expectedProofReceiptId ?? receipt.proof.receiptId)
  ) {
    return { ok: false, reason: "identity" };
  }

  const [candidateAcceptance] = await tx
    .select({
      id: aiExecutionAcceptancesTable.id,
      executionId: aiExecutionAcceptancesTable.executionId,
      attempt: aiExecutionAcceptancesTable.attempt,
      goalId: aiExecutionsTable.goalId,
      executionAttempt: aiExecutionsTable.attempt,
      operationId: aiExecutionsTable.operationId,
    })
    .from(aiExecutionAcceptancesTable)
    .innerJoin(aiExecutionsTable, eq(aiExecutionsTable.id, aiExecutionAcceptancesTable.executionId))
    .where(and(
      eq(aiExecutionAcceptancesTable.id, skillCandidate.proof.receiptId),
      eq(aiExecutionAcceptancesTable.projectId, input.projectId),
    ))
    .for("update")
    .limit(1);
  const [replayExecution] = await tx
    .select({
      id: aiExecutionsTable.id,
      projectId: aiExecutionsTable.projectId,
      goalId: aiExecutionsTable.goalId,
      attempt: aiExecutionsTable.attempt,
      operationId: aiExecutionsTable.operationId,
      idempotencyKey: aiExecutionsTable.idempotencyKey,
      request: aiExecutionsTable.request,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, replay.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
    ))
    .for("update")
    .limit(1);
  if (
    !candidateAcceptance
    || !replayExecution
    || candidateAcceptance.executionId === replay.executionId
    || candidateAcceptance.attempt !== candidateAcceptance.executionAttempt
    || candidateAcceptance.operationId !== proposal.operationId
    || !candidateAcceptance.goalId
    || candidateAcceptance.goalId !== replayExecution.goalId
    || replayExecution.operationId !== replay.operationId
    || replayExecution.idempotencyKey !== replay.idempotencyKey
    || replayExecution.attempt !== replay.attempt
  ) {
    return { ok: false, reason: "identity" };
  }
  const replayRequest = readJsonRecord(replayExecution.request);
  if (
    !replayRequest
    || replayRequest.operationId !== replay.operationId
    || replayRequest.executionProfile !== "shadow-replay"
    || replayRequest.workspaceRevision !== proposal.baseRevision
    || replayRequest.proofRequired !== true
    || replayRequest.proofEvidenceMode !== "artifact_only"
  ) {
    return { ok: false, reason: "identity" };
  }
  if (
    !await lockCurrentAcceptanceEvidence(
      tx,
      skillCandidate.proof.receiptId,
      candidateAcceptance.executionId,
      candidateAcceptance.executionAttempt,
    )
    || !await lockCurrentAcceptanceEvidence(
      tx,
      receipt.proof.receiptId,
      replay.executionId,
      replayExecution.attempt,
    )
  ) {
    return { ok: false, reason: "proof" };
  }

  const [goal] = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, candidateAcceptance.goalId),
      eq(aiGoalsTable.projectId, input.projectId),
    ))
    .for("update")
    .limit(1);
  const [mission] = goal
    ? await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, goal.missionId),
        eq(aiMissionsTable.projectId, input.projectId),
      ))
      .for("update")
      .limit(1)
    : [];
  const planRevision = goal ? readPlanRevision(goal.outcomeContract) : undefined;
  const activePlanRevision = mission ? readActivePlanRevision(mission.autonomyPolicy) : undefined;
  if (
    !goal
    || !mission
    || goal.status !== "completed"
    || !["active", "waiting", "completed"].includes(mission.status)
    || !planRevision
    || !activePlanRevision
    || planRevision !== activePlanRevision
  ) {
    return { ok: false, reason: "proof" };
  }

  const dependencyState = await evaluateGoalDependencyState(tx, mission, goal, {
    targetExecutionId: candidateAcceptance.executionId,
  });
  if (
    dependencyState.planRevision !== planRevision
    || dependencyState.dependencies.length !== dependencyState.dependencyGoals.length
    || dependencyState.dependencyGoals.some((dependency) => dependency.status !== "completed")
    || dependencyState.unprovenDependencies.length > 0
  ) {
    return { ok: false, reason: "proof" };
  }

  const candidateProof = await loadCanonicalProof({
    tx,
    executionId: candidateAcceptance.executionId,
    scope: {
      projectId: input.projectId,
      missionId: mission.id,
      goalId: goal.id,
      executionId: candidateAcceptance.executionId,
      operationId: proposal.operationId,
      planRevision,
      activePlanRevision,
      sourceRevisionBinding: "scope",
      candidateIdentityBinding: "required",
      sourceRevision: proposal.baseRevision,
      candidateIdentity: proposal.candidateTreeHash,
    },
    goalStatus: goal.status,
  });
  const replayProof = await loadCanonicalProof({
    tx,
    executionId: replay.executionId,
    scope: {
      projectId: input.projectId,
      missionId: mission.id,
      goalId: goal.id,
      executionId: replay.executionId,
      operationId: replay.operationId,
      planRevision,
      activePlanRevision,
      sourceRevisionBinding: "scope",
      candidateIdentityBinding: "required",
      sourceRevision: proposal.baseRevision,
      candidateIdentity: proposal.candidateTreeHash,
    },
    goalStatus: goal.status,
  });
  const candidateDecision = validateSkillCandidateAgainstCanonicalProof(skillCandidate, candidateProof, {
    projectId: input.projectId,
    sourceRevision: proposal.baseRevision,
    candidateTreeHash: proposal.candidateTreeHash,
    changeSetHash: proposal.changeSetHash,
  });
  if (
    !candidateProof.accepted
    || candidateProof.verdict !== "PROVEN"
    || candidateProof.acceptanceId !== skillCandidate.proof.receiptId
    || !candidateDecision.allowed
    || candidateProof.trajectoryDigest?.digest !== replay.trajectoryDigest
    || !replayProof.accepted
    || replayProof.verdict !== "PROVEN"
    || replayProof.acceptanceId !== replay.replayCanonicalAcceptanceId
    || replayProof.acceptanceId !== receipt.proof.receiptId
    || replayProof.trajectoryDigest?.digest !== receipt.proof.trajectoryDigest
  ) {
    return { ok: false, reason: "proof" };
  }

  const shadowScore = buildSkillShadowScore({
    comparison: receipt.pairedBaseline,
    replayId: replay.id,
    candidateId,
    candidateTreeHash: proposal.candidateTreeHash,
    baselineTreeHash: proposal.baseTreeHash,
  });
  if (!shadowScore) return { ok: false, reason: "paired-baseline" };

  let liveCandidateHash: string;
  try {
    liveCandidateHash = await assertCandidateWorkspaceIdentity({
      operationId: proposal.operationId,
      sourceWorkspaceRoot: proposal.workspaceRoot,
      candidateTreeHash: proposal.candidateTreeHash,
    });
  } catch {
    return { ok: false, reason: "identity" };
  }
  if (liveCandidateHash !== proposal.candidateTreeHash) {
    return { ok: false, reason: "identity" };
  }

  return { ok: true, proposal, replay, receipt, shadowScore };
}
