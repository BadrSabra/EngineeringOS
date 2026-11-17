import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiApplyJournalTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  projectsTable,
  db,
} from "@workspace/db";
import {
  ApplyAuthorizationDecisionSchema,
  ApplyPreconditionReceiptSchema,
  ApplyWorldTransitionIntentSchema,
  PROOF_GRAPH_VERSION,
  canonicalJsonHash,
  hashObservationValue,
  hashProofGraph,
  parseAgentActionRequestedPayload,
  validateProofGraph,
  type ProofGraph,
  type ProofGraphControlNode,
  type ProofGraphDataNode,
  type ProofGraphEdge,
  type ProofGraphExecutionNode,
  type ProofGraphValidationResult,
} from "@workspace/ai-orchestrator";
import {
  applyChangesMissionRequirement,
  evaluateApplyChangesD2,
} from "./agent-state/apply-changes-mission-gate.js";
import { loadCanonicalProof } from "./proof-foundation.js";
import type { CanonicalProof } from "./proof-foundation.js";

type ProjectorTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProjectApplyChangesProofGraphInput = {
  projectId: string;
  executionId: string;
  expectedAttempt: number;
  userId: string;
};

export type ApplyChangesProofGraphReason =
  | "ATTEMPT_INVALID"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ACCESS_MISMATCH"
  | "EXECUTION_NOT_FOUND"
  | "EXECUTION_IDENTITY_MISMATCH"
  | "EXECUTION_NOT_COMPLETED"
  | "UNSUPPORTED_PROOF_MODE"
  | "MISSION_LINK_MISSING"
  | "MISSION_NOT_FOUND"
  | "MISSION_ACCESS_MISMATCH"
  | "GOAL_NOT_FOUND"
  | "GOAL_NOT_COMPLETED"
  | "ACTIVE_PLAN_MISMATCH"
  | "APPLY_REQUIREMENT_INVALID"
  | "ACCEPTANCE_MISSING"
  | "EVIDENCE_SNAPSHOT_MISSING"
  | "EVIDENCE_INCOMPLETE"
  | "CANONICAL_PROOF_REJECTED"
  | "APPLY_PROOF_V2_MISSING"
  | "APPLY_PROOF_V2_MISMATCH"
  | "SOURCE_ROWS_MISSING"
  | "SOURCE_HASH_MISMATCH"
  | "IDENTITY_MISMATCH"
  | "REVISION_MISMATCH"
  | "D2_NOT_PROVEN"
  | "WORLD_TRANSITION_MISMATCH"
  | "OBSERVATION_MISMATCH"
  | "GRAPH_INVALID";

export type ApplyChangesCanonicalProofSummary = {
  accepted: true;
  verdict: "PROVEN";
  executionId: string;
  acceptanceId: string;
  evidenceSnapshotId: string;
  attempt: number;
  operationId: string;
  sourceRevision: string;
  candidateIdentity: string;
};

export type ApplyChangesD2Summary = {
  state: "proven";
  goalId: string;
  missionId: string;
  planRevision: string;
  executionId: string;
  attempt: number;
  acceptanceId: string;
  transitionId: string;
  resultingWorldRevision: string;
  candidateIdentity: string;
  beforeObservationIds: string[];
  afterObservationIds: string[];
};

export type ApplyChangesProofGraphProjectorResult =
  | {
      kind: "NOT_PROJECTABLE";
      authority: "READ_ONLY_PROJECTION";
      executionId: string;
      expectedAttempt: number;
      reasons: ApplyChangesProofGraphReason[];
      structuralValidation?: ProofGraphValidationResult;
    }
  | {
      kind: "PROJECTED";
      authority: "READ_ONLY_PROJECTION";
      graph: ProofGraph;
      graphHash: string;
      canonicalProof: ApplyChangesCanonicalProofSummary;
      missionD2: ApplyChangesD2Summary;
      structuralValidation: ProofGraphValidationResult;
    };

type JsonRecord = Record<string, unknown>;
type ControlRule =
  | "AUTHORIZATION_VALID"
  | "SCOPE_MATCHED"
  | "PRECONDITIONS_SATISFIED"
  | "PARENT_REVISION_MATCHED"
  | "WORKSPACE_BASE_REVISION_MATCHED"
  | "EFFECT_PROVEN"
  | "ACCEPTANCE_SUCCEEDED"
  | "WORLD_TRANSITION_MATERIALIZED";

type DataSpec = {
  key: string;
  evidenceRef: string;
  content: unknown;
  evidenceKind: ProofGraphDataNode["evidenceKind"];
  revisionDomain: ProofGraphDataNode["revisionDomain"];
  sourceRevision: string;
  provenance: ProofGraphDataNode["provenance"];
  freshness: ProofGraphDataNode["freshness"];
};

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function stableEqual(left: unknown, right: unknown): boolean {
  return canonicalJsonHash(left as Parameters<typeof canonicalJsonHash>[0])
    === canonicalJsonHash(right as Parameters<typeof canonicalJsonHash>[0]);
}

function makeDataNode(
  input: ProjectApplyChangesProofGraphInput,
  spec: DataSpec,
): ProofGraphDataNode {
  return {
    id: "data:" + spec.key + ":" + input.executionId + ":" + input.expectedAttempt,
    kind: "DATA",
    evidenceRef: spec.evidenceRef,
    contentHash: canonicalJsonHash(spec.content as Parameters<typeof canonicalJsonHash>[0]),
    evidenceKind: spec.evidenceKind,
    revisionDomain: spec.revisionDomain,
    sourceRevision: spec.sourceRevision,
    provenance: spec.provenance,
    freshness: spec.freshness,
  };
}

function makeControlNode(ruleId: ControlRule, evidenceRefs: readonly string[]): ProofGraphControlNode {
  const phase = ruleId === "EFFECT_PROVEN"
    || ruleId === "ACCEPTANCE_SUCCEEDED"
    || ruleId === "WORLD_TRANSITION_MATERIALIZED"
    ? "POST_EXECUTION"
    : "PRE_EXECUTION";
  return {
    id: "control:" + ruleId,
    kind: "CONTROL",
    ruleId,
    phase,
    outcome: "SATISFIED",
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
  };
}

function makeEdge(
  type: ProofGraphEdge["type"],
  from: string,
  to: string,
): ProofGraphEdge {
  return {
    id: "edge:" + canonicalJsonHash({ type, from, to }),
    type,
    from,
    to,
  } as ProofGraphEdge;
}

function notProjectable(
  input: ProjectApplyChangesProofGraphInput,
  reason: ApplyChangesProofGraphReason,
  structuralValidation?: ProofGraphValidationResult,
): ApplyChangesProofGraphProjectorResult {
  return {
    kind: "NOT_PROJECTABLE",
    authority: "READ_ONLY_PROJECTION",
    executionId: input.executionId,
    expectedAttempt: input.expectedAttempt,
    reasons: [reason],
    ...(structuralValidation ? { structuralValidation } : {}),
  };
}

function canonicalFailureReason(proof: CanonicalProof): ApplyChangesProofGraphReason {
  if (proof.failureReasons.includes("evidence_incomplete")) return "EVIDENCE_INCOMPLETE";
  if (
    proof.failureReasons.includes("source_revision_mismatch")
    || proof.failureReasons.includes("missing_source_revision")
    || proof.failureReasons.includes("missing_evidence_source_revision")
  ) return "REVISION_MISMATCH";
  if (
    proof.failureReasons.includes("execution_identity_mismatch")
    || proof.failureReasons.includes("acceptance_execution_mismatch")
    || proof.failureReasons.includes("acceptance_attempt_mismatch")
    || proof.failureReasons.includes("candidate_identity_mismatch")
    || proof.failureReasons.includes("evidence_snapshot_mismatch")
  ) return "IDENTITY_MISMATCH";
  if (proof.failureReasons.includes("apply_changes_proof_mismatch")) return "APPLY_PROOF_V2_MISMATCH";
  if (proof.failureReasons.includes("missing_acceptance")) return "ACCEPTANCE_MISSING";
  if (proof.failureReasons.includes("missing_evidence_snapshot")) return "EVIDENCE_SNAPSHOT_MISSING";
  return "CANONICAL_PROOF_REJECTED";
}

/**
 * Builds a read-only Apply Proof Graph from server-owned V2 evidence.
 *
 * The caller must use one PostgreSQL REPEATABLE READ transaction. Mission and
 * Goal are locked first, followed by loadCanonicalProof's Execution,
 * Acceptance, Snapshot, Proposal, Episode and evidence-row locks. D2 is then
 * evaluated with lockRows=false, so it cannot reverse the established lock
 * order by acquiring a Transition lock after the Episode lock.
 *
 * This function performs SELECTs only. A structural PASS is diagnostic and
 * does not create Acceptance, materialize World State, or release a Goal.
 */
export async function projectApplyChangesProofGraph(
  tx: ProjectorTransaction,
  input: ProjectApplyChangesProofGraphInput,
): Promise<ApplyChangesProofGraphProjectorResult> {
  if (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 0) {
    return notProjectable(input, "ATTEMPT_INVALID");
  }
  if (!input.projectId.trim() || !input.executionId.trim() || !input.userId.trim()) {
    return notProjectable(input, "IDENTITY_MISMATCH");
  }

  const [project] = await tx.select({
    id: projectsTable.id,
    ownerId: projectsTable.ownerId,
  }).from(projectsTable)
    .where(eq(projectsTable.id, input.projectId))
    .limit(1);
  if (!project) return notProjectable(input, "PROJECT_NOT_FOUND");
  if (project.ownerId !== input.userId) {
    return notProjectable(input, "PROJECT_ACCESS_MISMATCH");
  }

  // This unlocked probe supplies the Goal identity needed to follow the
  // repository's Mission -> Goal -> Execution lock order.
  const [executionProbe] = await tx.select({
    id: aiExecutionsTable.id,
    goalId: aiExecutionsTable.goalId,
    attempt: aiExecutionsTable.attempt,
    status: aiExecutionsTable.status,
    userId: aiExecutionsTable.userId,
    projectId: aiExecutionsTable.projectId,
    operationId: aiExecutionsTable.operationId,
    correlationId: aiExecutionsTable.correlationId,
  }).from(aiExecutionsTable).where(and(
    eq(aiExecutionsTable.id, input.executionId),
    eq(aiExecutionsTable.projectId, input.projectId),
  )).limit(1);
  if (!executionProbe) return notProjectable(input, "EXECUTION_NOT_FOUND");
  if (executionProbe.attempt !== input.expectedAttempt) {
    return notProjectable(input, "ATTEMPT_INVALID");
  }
  if (executionProbe.status !== "completed") {
    return notProjectable(input, "EXECUTION_NOT_COMPLETED");
  }
  if (!executionProbe.goalId || executionProbe.userId !== input.userId) {
    return notProjectable(input, "EXECUTION_IDENTITY_MISMATCH");
  }

  const [goalProbe] = await tx.select({
    id: aiGoalsTable.id,
    missionId: aiGoalsTable.missionId,
  }).from(aiGoalsTable).where(and(
    eq(aiGoalsTable.id, executionProbe.goalId),
    eq(aiGoalsTable.projectId, input.projectId),
  )).limit(1);
  if (!goalProbe?.missionId) return notProjectable(input, "MISSION_LINK_MISSING");

  const [mission] = await tx.select().from(aiMissionsTable).where(and(
    eq(aiMissionsTable.id, goalProbe.missionId),
    eq(aiMissionsTable.projectId, input.projectId),
  )).for("update").limit(1);
  if (!mission) return notProjectable(input, "MISSION_NOT_FOUND");
  if (mission.userId !== input.userId) {
    return notProjectable(input, "MISSION_ACCESS_MISMATCH");
  }

  const [goal] = await tx.select().from(aiGoalsTable).where(and(
    eq(aiGoalsTable.id, executionProbe.goalId),
    eq(aiGoalsTable.missionId, mission.id),
    eq(aiGoalsTable.projectId, input.projectId),
  )).for("update").limit(1);
  if (!goal) return notProjectable(input, "GOAL_NOT_FOUND");
  if (goal.missionId !== mission.id || goal.id !== executionProbe.goalId) {
    return notProjectable(input, "IDENTITY_MISMATCH");
  }
  if (goal.status !== "completed") {
    return notProjectable(input, "GOAL_NOT_COMPLETED");
  }

  const policy = record(mission.autonomyPolicy);
  const activePlanRevision = stringValue(policy.activePlanRevision);
  if (!activePlanRevision || !isDigest(activePlanRevision)) {
    return notProjectable(input, "ACTIVE_PLAN_MISMATCH");
  }
  const requirement = applyChangesMissionRequirement(goal, mission, activePlanRevision);
  if (requirement.kind !== "valid") {
    return notProjectable(
      input,
      requirement.kind === "invalid" ? "ACTIVE_PLAN_MISMATCH" : "APPLY_REQUIREMENT_INVALID",
    );
  }
  if (requirement.planRevision !== activePlanRevision) {
    return notProjectable(input, "ACTIVE_PLAN_MISMATCH");
  }
  if (
    !stringValue(executionProbe.operationId)
    || executionProbe.correlationId !== requirement.operationId
  ) return notProjectable(input, "IDENTITY_MISMATCH");

  const canonicalProofInputBase = {
    tx,
    executionId: input.executionId,
    attempt: input.expectedAttempt,
    goalStatus: goal.status,
    scope: {
      projectId: input.projectId,
      missionId: mission.id,
      goalId: goal.id,
      executionId: input.executionId,
      operationId: executionProbe.operationId!,
      planRevision: requirement.planRevision,
      activePlanRevision,
      sourceRevisionBinding: "execution" as const,
      candidateIdentityBinding: "required" as const,
      sourceRevision: null,
      candidateIdentity: requirement.candidateIdentity,
    },
  };
  const canonicalProof = await loadCanonicalProof(canonicalProofInputBase);
  if (!canonicalProof.accepted || canonicalProof.verdict !== "PROVEN") {
    return notProjectable(input, canonicalFailureReason(canonicalProof));
  }

  const [execution] = await tx.select().from(aiExecutionsTable).where(and(
    eq(aiExecutionsTable.id, input.executionId),
    eq(aiExecutionsTable.projectId, input.projectId),
    eq(aiExecutionsTable.attempt, input.expectedAttempt),
  )).limit(1);
  const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable).where(and(
    eq(aiExecutionAcceptancesTable.executionId, input.executionId),
    eq(aiExecutionAcceptancesTable.projectId, input.projectId),
    eq(aiExecutionAcceptancesTable.attempt, input.expectedAttempt),
  )).orderBy(desc(aiExecutionAcceptancesTable.createdAt)).limit(1);
  if (!execution || !acceptance) return notProjectable(input, "ACCEPTANCE_MISSING");
  if (
    execution.goalId !== goal.id
    || execution.userId !== input.userId
    || execution.operationId !== executionProbe.operationId
    || execution.correlationId !== requirement.operationId
    || acceptance.outcome !== "SUCCEEDED"
    || acceptance.terminalStatus !== "completed"
    || acceptance.attempt !== input.expectedAttempt
    || !acceptance.operationId
    || acceptance.operationId !== execution.operationId
    || !acceptance.evidenceSnapshotId
    || acceptance.sourceRevision !== execution.baseRevision
    || acceptance.candidateIdentity !== requirement.candidateIdentity
  ) return notProjectable(input, "IDENTITY_MISMATCH");
  if (!isDigest(execution.baseRevision) || !isDigest(requirement.baseTreeHash)) {
    return notProjectable(input, "REVISION_MISMATCH");
  }

  const [snapshot] = await tx.select().from(aiExecutionEvidenceSnapshotsTable).where(and(
    eq(aiExecutionEvidenceSnapshotsTable.id, acceptance.evidenceSnapshotId),
    eq(aiExecutionEvidenceSnapshotsTable.executionId, execution.id),
    eq(aiExecutionEvidenceSnapshotsTable.projectId, input.projectId),
    eq(aiExecutionEvidenceSnapshotsTable.attempt, input.expectedAttempt),
  )).limit(1);
  if (!snapshot) return notProjectable(input, "EVIDENCE_SNAPSHOT_MISSING");
  if (
    !snapshot.complete
    || snapshot.verdict !== "PROVEN"
    || snapshot.sourceRevision !== execution.baseRevision
    || snapshot.candidateIdentity !== requirement.candidateIdentity
    || snapshot.operationId !== execution.operationId
  ) return notProjectable(input, "EVIDENCE_INCOMPLETE");

  const artifactRefs = Array.isArray(snapshot.artifactRefs) ? snapshot.artifactRefs : [];
  const applyArtifacts = artifactRefs.filter((value) => record(value).kind === "apply_changes");
  const artifact = applyArtifacts.length === 1 ? record(applyArtifacts[0]) : undefined;
  if (!artifact || artifact.version !== 2) {
    return notProjectable(input, "APPLY_PROOF_V2_MISSING");
  }
  if (
    artifact.executionId !== execution.id
    || artifact.attempt !== input.expectedAttempt
    || artifact.operationId !== execution.operationId
    || artifact.proposalId !== requirement.requirement.proposalId
    || artifact.candidateIdentity !== requirement.candidateIdentity
    || artifact.sourceRevision !== execution.baseRevision
    || artifact.baseTreeHash !== requirement.baseTreeHash
    || artifact.candidateTreeHash !== requirement.requirement.candidateTreeHash
    || artifact.changeSetHash !== requirement.requirement.changeSetHash
    || artifact.episodeId === undefined
    || artifact.actionId === undefined
  ) return notProjectable(input, "APPLY_PROOF_V2_MISMATCH");

  const requestRecord = (() => {
    try {
      return record(JSON.parse(execution.request) as unknown);
    } catch {
      return {};
    }
  })();
  if (
    requestRecord.applyChangesProofMode !== "apply_changes_v2"
    || requestRecord.turnIntent !== "APPLY_CHANGES"
    || requestRecord.proofRequired !== true
    || requestRecord.effectRequired !== true
  ) return notProjectable(input, "UNSUPPORTED_PROOF_MODE");

  const proposalId = requirement.requirement.proposalId;
  const [proposal] = await tx.select().from(aiChangeProposalsTable).where(and(
    eq(aiChangeProposalsTable.id, proposalId),
    eq(aiChangeProposalsTable.projectId, input.projectId),
  )).limit(1);
  if (!proposal) return notProjectable(input, "SOURCE_ROWS_MISSING");
  if (
    proposal.status !== "applied"
    || (proposal.lifecycle !== "applied" && proposal.lifecycle !== "committed")
    || proposal.revision !== requirement.proposalRevision
    || proposal.operationId !== execution.correlationId
    || proposal.baseRevision !== execution.baseRevision
    || proposal.baseTreeHash !== requirement.baseTreeHash
    || proposal.candidateTreeHash !== requirement.requirement.candidateTreeHash
    || proposal.promotedTreeHash !== requirement.requirement.candidateTreeHash
    || proposal.changeSetHash !== requirement.requirement.changeSetHash
  ) return notProjectable(input, "IDENTITY_MISMATCH");

  const [episode] = await tx.select().from(aiAgentEpisodesTable).where(and(
    eq(aiAgentEpisodesTable.id, String(artifact.episodeId)),
    eq(aiAgentEpisodesTable.projectId, input.projectId),
    eq(aiAgentEpisodesTable.executionId, execution.id),
    eq(aiAgentEpisodesTable.attempt, input.expectedAttempt),
    eq(aiAgentEpisodesTable.missionId, mission.id),
    eq(aiAgentEpisodesTable.goalId, goal.id),
  )).limit(1);
  if (!episode) return notProjectable(input, "SOURCE_ROWS_MISSING");
  if (
    episode.intentKind !== "APPLY_CHANGES"
    || episode.planRevision !== requirement.planRevision
    || episode.worldRevision === null
    || !isDigest(episode.worldRevision)
    || episode.state !== "completed"
    || episode.verdict !== "achieved"
    || episode.projectRevision !== execution.baseRevision
  ) return notProjectable(input, "IDENTITY_MISMATCH");

  const actionEvents = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
    eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
    eq(aiAgentEpisodeEventsTable.executionId, execution.id),
    eq(aiAgentEpisodeEventsTable.attempt, input.expectedAttempt),
    eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
    inArray(aiAgentEpisodeEventsTable.id, [
      String(artifact.actionEventId),
      String(artifact.committedEventId),
    ]),
  )).orderBy(asc(aiAgentEpisodeEventsTable.sequence), asc(aiAgentEpisodeEventsTable.id));
  if (actionEvents.length !== 2) return notProjectable(input, "SOURCE_ROWS_MISSING");
  const requestedEvent = actionEvents.find((event) => event.eventType === "ACTION_REQUESTED");
  const committedEvent = actionEvents.find((event) => event.eventType === "ACTION_COMMITTED");
  if (!requestedEvent || !committedEvent) return notProjectable(input, "SOURCE_ROWS_MISSING");
  if (
    requestedEvent.id !== artifact.actionEventId
    || committedEvent.id !== artifact.committedEventId
    || canonicalJsonHash(record(requestedEvent.payload) as Parameters<typeof canonicalJsonHash>[0])
      !== requestedEvent.payloadHash
    || canonicalJsonHash(record(committedEvent.payload) as Parameters<typeof canonicalJsonHash>[0])
      !== committedEvent.payloadHash
  ) return notProjectable(input, "SOURCE_HASH_MISMATCH");

  let requestedPayload: ReturnType<typeof parseAgentActionRequestedPayload>;
  try {
    requestedPayload = parseAgentActionRequestedPayload(requestedEvent.payload);
  } catch {
    return notProjectable(input, "APPLY_PROOF_V2_MISMATCH");
  }
  const authorizationResult = ApplyAuthorizationDecisionSchema.safeParse(
    requestedPayload.authorizationDecision,
  );
  const preconditionResult = ApplyPreconditionReceiptSchema.safeParse(
    requestedPayload.preconditionReceipt,
  );
  const intentResult = ApplyWorldTransitionIntentSchema.safeParse(
    requestedPayload.worldTransitionIntent,
  );
  if (!authorizationResult.success || !preconditionResult.success || !intentResult.success) {
    return notProjectable(input, "APPLY_PROOF_V2_MISMATCH");
  }
  const authorization = authorizationResult.data;
  const receipt = preconditionResult.data;
  const intent = intentResult.data;
  if (
    authorization.actorUserId !== input.userId
    || authorization.projectOwnerId !== project.ownerId
    || authorization.projectId !== input.projectId
    || authorization.proposalId !== proposal.id
    || authorization.proposalRevision !== proposal.revision
    || authorization.executionId !== execution.id
    || authorization.attempt !== input.expectedAttempt
    || authorization.capabilityId !== requestedPayload.action.capabilityId
    || requestedPayload.action.actionId !== artifact.actionId
    || requestedPayload.action.episodeId !== episode.id
    || receipt.actionId !== requestedPayload.action.actionId
    || receipt.executionId !== execution.id
    || receipt.attempt !== input.expectedAttempt
    || receipt.planRevision !== requirement.planRevision
    || receipt.parentWorldRevision !== intent.parentWorldRevision
    || intent.projectId !== input.projectId
    || intent.proposalId !== proposal.id
    || intent.goalId !== goal.id
    || intent.planRevision !== requirement.planRevision
  ) return notProjectable(input, "IDENTITY_MISMATCH");

  const journalRefs = receipt.checks.map((check) => check.reference);
  const journalIds = [...new Set(journalRefs.map((reference) => reference.id))].sort();
  const artifactJournalIds = Array.isArray(artifact.preconditionJournalIds)
    ? artifact.preconditionJournalIds.filter((value): value is string => typeof value === "string").sort()
    : [];
  if (
    new Set(artifactJournalIds).size !== artifactJournalIds.length
    || journalIds.length !== artifactJournalIds.length
    || journalIds.some((id, index) => id !== artifactJournalIds[index])
    || artifact.authorizationDecisionHash !== authorization.decisionHash
    || artifact.preconditionReceiptHash !== receipt.receiptHash
  ) return notProjectable(input, "APPLY_PROOF_V2_MISMATCH");

  const journalRows = await tx.select().from(aiApplyJournalTable).where(and(
    eq(aiApplyJournalTable.projectId, input.projectId),
    eq(aiApplyJournalTable.proposalId, proposal.id),
    inArray(aiApplyJournalTable.id, journalIds),
  )).orderBy(asc(aiApplyJournalTable.sequence), asc(aiApplyJournalTable.id));
  if (journalRows.length !== journalIds.length) return notProjectable(input, "SOURCE_ROWS_MISSING");

  const expectedJournalAttemptId = stringValue(requestRecord.applyAttemptId)
    ?? stringValue(requestRecord.operationId);
  const expectedJournalOperationId = stringValue(proposal.operationId);
  if (!expectedJournalAttemptId || !expectedJournalOperationId) {
    return notProjectable(input, "IDENTITY_MISMATCH");
  }
  for (const reference of journalRefs) {
    const row = journalRows.find((candidate) => candidate.id === reference.id);
    if (!row) return notProjectable(input, "SOURCE_ROWS_MISSING");
    if (
      row.stage !== reference.stage
      || row.operationId !== expectedJournalOperationId
      || row.attemptId !== expectedJournalAttemptId
      || canonicalJsonHash(record(row.payload) as Parameters<typeof canonicalJsonHash>[0])
        !== reference.contentHash
    ) return notProjectable(input, "SOURCE_HASH_MISMATCH");
  }

  const committedPayload = record(committedEvent.payload);
  if (
    committedPayload.actionId !== artifact.actionId
    || committedPayload.status !== "promoted"
    || committedPayload.afterTreeHash !== requirement.requirement.candidateTreeHash
  ) return notProjectable(input, "APPLY_PROOF_V2_MISMATCH");

  const d2 = await evaluateApplyChangesD2(tx, {
    goal,
    mission,
    activePlanRevision,
    lockRows: false,
  });
  if (d2.state !== "proven") return notProjectable(input, "D2_NOT_PROVEN");
  if (
    d2.executionId !== execution.id
    || d2.attempt !== input.expectedAttempt
    || d2.planRevision !== requirement.planRevision
    || d2.candidateIdentity !== requirement.candidateIdentity
    || !acceptance.id
    || d2.acceptanceId !== acceptance.id
  ) return notProjectable(input, "IDENTITY_MISMATCH");

  const [transition] = await tx.select().from(aiWorldTransitionsTable).where(and(
    eq(aiWorldTransitionsTable.id, d2.transitionId),
    eq(aiWorldTransitionsTable.projectId, input.projectId),
    eq(aiWorldTransitionsTable.executionId, execution.id),
    eq(aiWorldTransitionsTable.attempt, input.expectedAttempt),
    eq(aiWorldTransitionsTable.episodeId, episode.id),
  )).limit(1);
  if (!transition) return notProjectable(input, "SOURCE_ROWS_MISSING");
  if (
    transition.status !== "materialized"
    || transition.freshness !== "fresh"
    || transition.parentWorldRevision !== intent.parentWorldRevision
    || transition.resultingWorldRevision !== d2.resultingWorldRevision
    || episode.worldRevision !== transition.resultingWorldRevision
    || !isDigest(transition.resultingWorldRevision)
    || !stableEqual(transition.parentFactRefs, intent.parentFactRefs)
    || transition.actionId !== requestedPayload.action.actionId
    || transition.effectBundleId !== acceptance.effectBundleId
    || transition.environmentRevision !== episode.environmentRevision
    || transition.taskScope !== "project"
  ) return notProjectable(input, "WORLD_TRANSITION_MISMATCH");

  const beforeIds = Array.isArray(artifact.beforeObservationIds)
    ? artifact.beforeObservationIds.filter((value): value is string => typeof value === "string")
    : [];
  const afterIds = Array.isArray(artifact.afterObservationIds)
    ? artifact.afterObservationIds.filter((value): value is string => typeof value === "string")
    : [];
  if (beforeIds.length !== 1 || afterIds.length !== 1) {
    return notProjectable(input, "OBSERVATION_MISMATCH");
  }

  const allObservationIds = [...new Set([
    ...beforeIds,
    ...afterIds,
    ...d2.beforeObservationIds,
    ...d2.afterObservationIds,
  ])];
  const observations = await tx.select().from(aiAgentObservationsTable).where(and(
    eq(aiAgentObservationsTable.projectId, input.projectId),
    eq(aiAgentObservationsTable.executionId, execution.id),
    eq(aiAgentObservationsTable.episodeId, episode.id),
    inArray(aiAgentObservationsTable.id, allObservationIds),
  )).orderBy(asc(aiAgentObservationsTable.sequence), asc(aiAgentObservationsTable.id));
  if (observations.length !== allObservationIds.length) {
    return notProjectable(input, "SOURCE_ROWS_MISSING");
  }
  const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
  const proofBefore = observationsById.get(beforeIds[0]!);
  const proofAfter = observationsById.get(afterIds[0]!);
  const d2Before = d2.beforeObservationIds.map((id) => observationsById.get(id));
  const d2After = d2.afterObservationIds.map((id) => observationsById.get(id));
  const observationValid = (
    observation: typeof observations[number] | undefined,
    expectedTreeHash: string,
    expectedSubject: string,
  ) => {
    if (!observation) return false;
    let digest: string;
    try {
      digest = hashObservationValue(
        observation.value as Parameters<typeof hashObservationValue>[0],
      );
    } catch {
      return false;
    }
    return observation.kind === "direct_observation"
      && observation.provenance === "DIRECT_OBSERVATION"
      && observation.observationRole === "workspace.tree_hash"
      && observation.predicate === "workspace.tree_hash"
      && observation.subject === expectedSubject
      && observation.value === expectedTreeHash
      && observation.valueHash === digest
      && observation.completeness === "complete"
      && observation.freshness === "fresh"
      && observation.environmentFreshness === "fresh"
      && observation.environmentRevision === episode.environmentRevision;
  };
  if (
    !observationValid(
      proofBefore,
      requirement.baseTreeHash,
      "project:" + requirement.candidateIdentity,
    )
    || !observationValid(
      proofAfter,
      requirement.requirement.candidateTreeHash,
      "project:" + requirement.candidateIdentity,
    )
    || d2Before.length === 0
    || d2After.length === 0
    || d2Before.some((observation) => !observationValid(
      observation,
      requirement.baseTreeHash,
      "project:" + input.projectId,
    ))
    || d2After.some((observation) => !observationValid(
      observation,
      requirement.requirement.candidateTreeHash,
      "project:" + input.projectId,
    ))
  ) return notProjectable(input, "OBSERVATION_MISMATCH");
  // Keep the source rows narrowed for the evidence projection below. The
  // validator above checks their contents; this guard also satisfies the
  // compiler's optional-row analysis for direct map lookups.
  if (!proofBefore || !proofAfter) {
    return notProjectable(input, "OBSERVATION_MISMATCH");
  }

  const scopeHash = canonicalJsonHash({
    projectId: input.projectId,
    missionId: mission.id,
    goalId: goal.id,
    executionId: execution.id,
    operationId: execution.operationId,
    proposalOperationId: proposal.operationId,
    proposalId: proposal.id,
    proposalRevision: proposal.revision,
    candidateIdentity: requirement.candidateIdentity,
    planRevision: requirement.planRevision,
    baseTreeHash: requirement.baseTreeHash,
    candidateTreeHash: requirement.requirement.candidateTreeHash,
    changeSetHash: requirement.requirement.changeSetHash,
  });

  // Every DATA node points to an existing durable row. The table identity
  // is encoded with the row ID so a consumer can resolve the reference without
  // treating a synthesized label as an evidence source.
  const preconditionDataSpecs: DataSpec[] = journalRows.map((row) => ({
    key: "precondition:" + row.id,
    evidenceRef: "db:aiApplyJournalTable/" + row.id,
    content: {
      receipt,
      journal: { id: row.id, stage: row.stage, payload: row.payload },
    },
    evidenceKind: "PRECONDITION",
    revisionDomain: "WORLD",
    sourceRevision: intent.parentWorldRevision,
    provenance: "SERVER_DERIVED",
    freshness: "fresh",
  }));

  const workspaceBaseDataSpecs: DataSpec[] = [
    {
      key: "candidate-workspace-base",
      evidenceRef: "db:aiAgentObservationsTable/" + proofBefore.id,
      content: proofBefore,
      evidenceKind: "PARENT_WORKSPACE_SNAPSHOT",
      revisionDomain: "WORKSPACE_TREE",
      sourceRevision: requirement.baseTreeHash,
      provenance: "SERVER_DERIVED",
      freshness: "fresh",
    },
    ...d2Before.map((observation) => {
      const row = observation!;
      return {
        key: "live-workspace-base:" + row.id,
        evidenceRef: "db:aiAgentObservationsTable/" + row.id,
        content: row,
        evidenceKind: "PARENT_WORKSPACE_SNAPSHOT",
        revisionDomain: "WORKSPACE_TREE",
        sourceRevision: requirement.baseTreeHash,
        provenance: "SERVER_DERIVED",
        freshness: "fresh",
      } satisfies DataSpec;
    }),
  ];

  const effectDataSpecs: DataSpec[] = [
    {
      key: "candidate-effect",
      evidenceRef: "db:aiAgentObservationsTable/" + proofAfter.id,
      content: proofAfter,
      evidenceKind: "EFFECT_OBSERVATION",
      revisionDomain: "WORKSPACE_TREE",
      sourceRevision: requirement.requirement.candidateTreeHash,
      provenance: "DIRECT_OBSERVATION",
      freshness: "fresh",
    },
    ...d2After.map((observation) => {
      const row = observation!;
      return {
        key: "live-effect:" + row.id,
        evidenceRef: "db:aiAgentObservationsTable/" + row.id,
        content: row,
        evidenceKind: "EFFECT_OBSERVATION",
        revisionDomain: "WORKSPACE_TREE",
        sourceRevision: requirement.requirement.candidateTreeHash,
        provenance: "DIRECT_OBSERVATION",
        freshness: "fresh",
      } satisfies DataSpec;
    }),
  ];

  if (
    preconditionDataSpecs.length === 0
    || preconditionDataSpecs.length > 64
    || workspaceBaseDataSpecs.length > 64
    || effectDataSpecs.length > 64
  ) return notProjectable(input, "GRAPH_INVALID");

  const dataSpecs: DataSpec[] = [
    {
      key: "authorization",
      evidenceRef: "db:aiAgentEpisodeEventsTable/" + requestedEvent.id,
      content: {
        decision: authorization,
        event: {
          id: requestedEvent.id,
          eventType: requestedEvent.eventType,
          payloadHash: requestedEvent.payloadHash,
        },
      },
      evidenceKind: "AUTHORIZATION",
      revisionDomain: "PLAN",
      sourceRevision: requirement.planRevision,
      provenance: "SERVER_DERIVED",
      freshness: "fresh",
    },
    {
      key: "scope",
      evidenceRef: "db:aiChangeProposalsTable/" + proposal.id,
      content: {
        proposal: {
          id: proposal.id,
          operationId: proposal.operationId,
          revision: proposal.revision,
          projectId: proposal.projectId,
        },
        projectId: input.projectId,
        missionId: mission.id,
        goalId: goal.id,
        executionId: execution.id,
        operationId: execution.operationId,
        proposalOperationId: proposal.operationId,
        proposalId: proposal.id,
        proposalRevision: proposal.revision,
        candidateIdentity: requirement.candidateIdentity,
        planRevision: requirement.planRevision,
        baseTreeHash: requirement.baseTreeHash,
        candidateTreeHash: requirement.requirement.candidateTreeHash,
        changeSetHash: requirement.requirement.changeSetHash,
      },
      evidenceKind: "SCOPE",
      revisionDomain: "PLAN",
      sourceRevision: requirement.planRevision,
      provenance: "SERVER_DERIVED",
      freshness: "fresh",
    },
    ...preconditionDataSpecs,
    {
      key: "parent-world",
      evidenceRef: "db:aiWorldTransitionsTable/" + transition.id,
      content: {
        intent,
        parentWorldRevision: transition.parentWorldRevision,
        parentFactRefs: transition.parentFactRefs,
      },
      evidenceKind: "PARENT_WORLD_SNAPSHOT",
      revisionDomain: "WORLD",
      sourceRevision: intent.parentWorldRevision,
      provenance: "SERVER_DERIVED",
      freshness: "fresh",
    },
    ...workspaceBaseDataSpecs,
    ...effectDataSpecs,
    {
      key: "acceptance",
      evidenceRef: "db:aiExecutionAcceptancesTable/" + acceptance.id,
      content: {
        canonicalProof: {
          verdict: canonicalProof.verdict,
          accepted: canonicalProof.accepted,
          executionId: canonicalProof.executionId,
          acceptanceId: canonicalProof.acceptanceId,
          evidenceSnapshotId: canonicalProof.evidenceSnapshotId,
          attempt: canonicalProof.attempt,
          operationId: canonicalProof.operationId,
          sourceRevision: canonicalProof.sourceRevision,
          candidateIdentity: canonicalProof.candidateIdentity,
        },
        acceptance: {
          id: acceptance.id,
          outcome: acceptance.outcome,
          terminalStatus: acceptance.terminalStatus,
          attempt: acceptance.attempt,
          operationId: acceptance.operationId,
          evidenceSnapshotId: acceptance.evidenceSnapshotId,
          evidenceRequired: acceptance.evidenceRequired,
          evidenceComplete: acceptance.evidenceComplete,
          sourceRevision: acceptance.sourceRevision,
          candidateIdentity: acceptance.candidateIdentity,
          effectBundleId: acceptance.effectBundleId,
        },
      },
      evidenceKind: "EXECUTION_ACCEPTANCE",
      revisionDomain: "PLAN",
      sourceRevision: requirement.planRevision,
      provenance: "SERVER_DERIVED",
      freshness: "fresh",
    },
    {
      key: "evidence-snapshot",
      evidenceRef: "db:aiExecutionEvidenceSnapshotsTable/" + snapshot.id,
      content: {
        id: snapshot.id,
        executionId: snapshot.executionId,
        projectId: snapshot.projectId,
        attempt: snapshot.attempt,
        verdict: snapshot.verdict,
        complete: snapshot.complete,
        sourceRevision: snapshot.sourceRevision,
        candidateIdentity: snapshot.candidateIdentity,
        operationId: snapshot.operationId,
      },
      evidenceKind: "EXECUTION_ACCEPTANCE",
      revisionDomain: "PLAN",
      sourceRevision: requirement.planRevision,
      provenance: "SERVER_DERIVED",
      freshness: "fresh",
    },
    {
      key: "world-transition",
      evidenceRef: "db:aiWorldTransitionsTable/" + transition.id,
      content: {
        id: transition.id,
        projectId: transition.projectId,
        executionId: transition.executionId,
        attempt: transition.attempt,
        episodeId: transition.episodeId,
        actionId: transition.actionId,
        effectBundleId: transition.effectBundleId,
        parentWorldRevision: transition.parentWorldRevision,
        resultingWorldRevision: transition.resultingWorldRevision,
        parentFactRefs: transition.parentFactRefs,
        changedFactRefs: transition.changedFactRefs,
        evidenceRefs: transition.evidenceRefs,
        status: transition.status,
        freshness: transition.freshness,
        environmentRevision: transition.environmentRevision,
      },
      evidenceKind: "WORLD_TRANSITION",
      revisionDomain: "WORLD",
      sourceRevision: transition.resultingWorldRevision,
      provenance: "SERVER_DERIVED",
      freshness: "fresh",
    },
  ];
  const dataNodes = dataSpecs.map((spec) => makeDataNode(input, spec));
  const dataByKey = new Map(dataSpecs.map((spec, index) => [spec.key, dataNodes[index]!]));
  const dataNodes = dataSpecs.map((spec) => makeDataNode(input, spec));
  const dataByKey = new Map(dataSpecs.map((spec, index) => [spec.key, dataNodes[index]!]));
  const rules: Array<{ rule: ControlRule; keys: string[] }> = [
    { rule: "AUTHORIZATION_VALID", keys: ["authorization"] },
    { rule: "SCOPE_MATCHED", keys: ["scope"] },
    { rule: "PRECONDITIONS_SATISFIED", keys: preconditionDataSpecs.map((spec) => spec.key) },
    { rule: "PARENT_REVISION_MATCHED", keys: ["parent-world"] },
    { rule: "WORKSPACE_BASE_REVISION_MATCHED", keys: workspaceBaseDataSpecs.map((spec) => spec.key) },
    { rule: "EFFECT_PROVEN", keys: effectDataSpecs.map((spec) => spec.key) },
    { rule: "ACCEPTANCE_SUCCEEDED", keys: ["acceptance", "evidence-snapshot"] },
    { rule: "WORLD_TRANSITION_MATERIALIZED", keys: ["world-transition"] },
  ];
  const controls = rules.map(({ rule, keys }) =>
    makeControlNode(rule, keys.map((key) => dataByKey.get(key)!.evidenceRef)),
  );
  const executionNode: ProofGraphExecutionNode = {
    id: execution.id,
    kind: "EXECUTION",
    projectId: input.projectId,
    episodeId: episode.id,
    attempt: input.expectedAttempt,
    missionId: mission.id,
    goalId: goal.id,
    role: "AGENT",
    actionId: requestedPayload.action.actionId,
    capabilityId: requestedPayload.action.capabilityId,
    scopeHash,
    planRevision: requirement.planRevision,
    operationKind: "MUTATION",
  };

  const edges: ProofGraphEdge[] = [];
  for (const { rule, keys } of rules) {
    const control = controls.find((candidate) => candidate.ruleId === rule)!;
    const evidenceNodes = keys.map((key) => dataByKey.get(key)!);
    for (const data of evidenceNodes) {
      edges.push(makeEdge("DATA_SUPPORTS_CONTROL", data.id, control.id));
    }
    if (control.phase === "PRE_EXECUTION") {
      edges.push(makeEdge("CONTROL_GATES_EXECUTION", control.id, executionNode.id));
      for (const data of evidenceNodes) {
        edges.push(makeEdge("EXECUTION_BINDS_DATA", executionNode.id, data.id));
      }
    } else {
      edges.push(makeEdge("EXECUTION_VERIFIED_BY_CONTROL", executionNode.id, control.id));
      for (const data of evidenceNodes) {
        if (rule === "EFFECT_PROVEN") {
          edges.push(makeEdge("EXECUTION_PRODUCES_DATA", executionNode.id, data.id));
        } else {
          edges.push(makeEdge("EXECUTION_BINDS_DATA", executionNode.id, data.id));
        }
      }
    }
  }

  const graph: ProofGraph = {
    version: PROOF_GRAPH_VERSION,
    graphId: "apply-proof-graph:" + execution.id + ":" + input.expectedAttempt,
    projectId: input.projectId,
    executionId: execution.id,
    episodeId: episode.id,
    attempt: input.expectedAttempt,
    missionId: mission.id,
    goalId: goal.id,
    planRevision: requirement.planRevision,
    parentWorldRevision: intent.parentWorldRevision,
    resultingWorldRevision: transition.resultingWorldRevision,
    parentWorkspaceRevision: requirement.baseTreeHash,
    resultingWorkspaceRevision: requirement.requirement.candidateTreeHash,
    nodes: [executionNode, ...dataNodes, ...controls],
    edges,
  };

  const structuralValidation = validateProofGraph(graph);
  if (structuralValidation.verdict !== "PASS" || !structuralValidation.graphHash) {
    return notProjectable(input, "GRAPH_INVALID", structuralValidation);
  }
  const graphHash = hashProofGraph(graph);
  if (graphHash !== structuralValidation.graphHash) {
    return notProjectable(input, "GRAPH_INVALID", structuralValidation);
  }

  return {
    kind: "PROJECTED",
    authority: "READ_ONLY_PROJECTION",
    graph,
    graphHash,
    canonicalProof: {
      accepted: true,
      verdict: "PROVEN",
      executionId: canonicalProof.executionId!,
      acceptanceId: canonicalProof.acceptanceId!,
      evidenceSnapshotId: canonicalProof.evidenceSnapshotId!,
      attempt: canonicalProof.attempt!,
      operationId: canonicalProof.operationId!,
      sourceRevision: canonicalProof.sourceRevision!,
      candidateIdentity: canonicalProof.candidateIdentity!,
    },
    missionD2: {
      state: "proven",
      goalId: goal.id,
      missionId: mission.id,
      planRevision: requirement.planRevision,
      executionId: d2.executionId,
      attempt: d2.attempt,
      acceptanceId: d2.acceptanceId,
      transitionId: d2.transitionId,
      resultingWorldRevision: d2.resultingWorldRevision,
      candidateIdentity: d2.candidateIdentity,
      beforeObservationIds: [...d2.beforeObservationIds],
      afterObservationIds: [...d2.afterObservationIds],
    },
    structuralValidation,
  };
}
