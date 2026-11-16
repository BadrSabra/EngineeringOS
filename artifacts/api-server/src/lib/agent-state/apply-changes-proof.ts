import { and, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiApplyJournalTable,
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentObservationsTable,
  aiChangeProposalsTable,
  aiExecutionsTable,
  projectsTable,
} from "@workspace/db";
import {
  ApplyAuthorizationDecisionSchema,
  ApplyPreconditionReceiptSchema,
  ApplyWorldTransitionIntentSchema,
  canonicalJsonHash,
  hashEffectContract,
} from "@workspace/ai-orchestrator";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  buildApplyChangeAction,
  buildApplyChangeEffectContract,
} from "./apply-change-effect.js";

export const APPLY_CHANGES_PROOF_MODE_V1 = "apply_changes_v1" as const;
export const APPLY_CHANGES_PROOF_MODE_V2 = "apply_changes_v2" as const;
/** Kept as the v1 alias so existing fixtures and historical callers remain explicit. */
export const APPLY_CHANGES_PROOF_MODE = APPLY_CHANGES_PROOF_MODE_V1;

export function isApplyChangesProofMode(
  value: unknown,
): value is typeof APPLY_CHANGES_PROOF_MODE_V1 | typeof APPLY_CHANGES_PROOF_MODE_V2 {
  return value === APPLY_CHANGES_PROOF_MODE_V1 || value === APPLY_CHANGES_PROOF_MODE_V2;
}

type ApplyChangesProofArtifactBase = {
  kind: "apply_changes";
  executionId: string;
  attempt: number;
  operationId: string;
  proposalId: string;
  proposalOperationId: string;
  sourceRevision: string;
  candidateIdentity: string;
  baseTreeHash: string;
  candidateTreeHash: string;
  changeSetHash: string;
  episodeId: string;
  actionId: string;
  actionEventId: string;
  committedEventId: string;
  effectBundleId: string;
  effectId: string;
  actionHash: string;
  effectContractHash: string;
  beforeObservationIds: string[];
  afterObservationIds: string[];
};

export type ApplyChangesProofArtifactV1 = ApplyChangesProofArtifactBase & {
  version: 1;
};

export type ApplyChangesProofArtifactV2 = ApplyChangesProofArtifactBase & {
  version: 2;
  authorizationDecisionHash: string;
  preconditionReceiptHash: string;
  preconditionJournalIds: string[];
};

export type ApplyChangesProofArtifact =
  | ApplyChangesProofArtifactV1
  | ApplyChangesProofArtifactV2;

type ApplyChangesProofV2Evidence = Pick<
  ApplyChangesProofArtifactV2,
  "authorizationDecisionHash" | "preconditionReceiptHash" | "preconditionJournalIds"
>;

type ApplyChangesProofTransaction =
  Parameters<Parameters<typeof import("@workspace/db").db.transaction>[0]>[0];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) =>
    typeof item !== "string" || !item.trim()
  )) return undefined;
  return value as string[];
}

function treeHash(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const parsed = record(value);
  return typeof parsed?.treeHash === "string" ? parsed.treeHash : undefined;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

const APPLY_PRECONDITION_STAGE_BY_ID = {
  PROJECT_OWNER_MATCHED: "APPLY_AUTHORIZATION_DECISION",
  PROPOSAL_ELIGIBLE: "APPLY_AUTHORIZATION_DECISION",
  EXACT_APPROVED_SUBSET: "APPLY_APPROVED_SUBSET",
  CANDIDATE_VALIDATION_PASSED: "APPLY_VALIDATION_PASSED",
  CANDIDATE_STABLE: "APPLY_CANDIDATE_STABLE",
  LIVE_ROOT_BASE_MATCHED: "APPLY_CANDIDATE_STABLE",
  EXECUTION_LEASE_OWNED: "APPLY_EXECUTION_LEASE",
  MISSION_PARENT_SNAPSHOT_BOUND: "APPLY_PARENT_SNAPSHOT",
} as const;

async function deriveApplyChangesProofV2Evidence(input: {
  tx: ApplyChangesProofTransaction;
  execution: typeof aiExecutionsTable.$inferSelect;
  proposal: typeof aiChangeProposalsTable.$inferSelect;
  episode: typeof aiAgentEpisodesTable.$inferSelect;
  request: Record<string, unknown>;
  requestedPayload: Record<string, unknown>;
  actionId: string;
  requestedEvent: typeof aiAgentEpisodeEventsTable.$inferSelect;
  sourceRevision: string;
  candidateIdentity: string;
}): Promise<ApplyChangesProofV2Evidence | undefined> {
  const {
    tx, execution, proposal, episode, request, requestedPayload, actionId, requestedEvent,
    sourceRevision, candidateIdentity,
  } = input;
  const authorizationResult = ApplyAuthorizationDecisionSchema.safeParse(
    requestedPayload.authorizationDecision,
  );
  const preconditionResult = ApplyPreconditionReceiptSchema.safeParse(
    requestedPayload.preconditionReceipt,
  );
  if (!authorizationResult.success || !preconditionResult.success) return undefined;
  const authorization = authorizationResult.data;
  const preconditions = preconditionResult.data;
  let proposalChanges: unknown;
  try {
    proposalChanges = typeof proposal.changes === "string"
      ? JSON.parse(proposal.changes)
      : proposal.changes;
  } catch {
    return undefined;
  }
  if (!Array.isArray(proposalChanges)) return undefined;
  const [project] = await tx.select({
    id: projectsTable.id,
    ownerId: projectsTable.ownerId,
  }).from(projectsTable).where(eq(projectsTable.id, execution.projectId)).limit(1);
  const requestedPaths = Array.isArray(request.validationTargetPaths)
    && request.validationTargetPaths.every((item) => typeof item === "string" && item.trim())
    ? request.validationTargetPaths as string[]
    : undefined;
  if (
    !project
    || !requestedPaths
    || authorization.decision !== "ALLOW"
    || authorization.actorUserId !== execution.userId
    || authorization.actorUserId !== project.ownerId
    || authorization.projectOwnerId !== project.ownerId
    || authorization.projectId !== execution.projectId
    || authorization.proposalId !== proposal.id
    || candidateIdentity !== `${proposal.id}:${proposal.candidateTreeHash}`
    || authorization.proposalRevision !== proposal.revision
    || authorization.executionId !== execution.id
    || authorization.attempt !== execution.attempt
    || authorization.capabilityId !== APPLY_CHANGE_CAPABILITY_ID
    || authorization.approvedPathsHash !== canonicalJsonHash([...requestedPaths].sort())
    || authorization.proposalChangesHash !== canonicalJsonHash(
      proposalChanges as Parameters<typeof canonicalJsonHash>[0],
    )
    || authorization.changeSetHash !== proposal.changeSetHash
    || (request.applyChangesProofMode === APPLY_CHANGES_PROOF_MODE_V2
      && request.changeSetHash !== authorization.changeSetHash)
    || preconditions.actionId !== actionId
    || preconditions.executionId !== execution.id
    || preconditions.attempt !== execution.attempt
  ) return undefined;

  const worldIntentResult = requestedPayload.worldTransitionIntent === undefined
    ? undefined
    : ApplyWorldTransitionIntentSchema.safeParse(requestedPayload.worldTransitionIntent);
  if (requestedPayload.worldTransitionIntent !== undefined && !worldIntentResult?.success) {
    return undefined;
  }
  const worldIntent = worldIntentResult?.success ? worldIntentResult.data : undefined;
  const missionBound = Boolean(execution.goalId || episode.goalId || episode.missionId);
  if (missionBound && !worldIntent) return undefined;
  if (
    worldIntent
    && (
      worldIntent.projectId !== execution.projectId
      || worldIntent.proposalId !== proposal.id
      || worldIntent.goalId !== execution.goalId
      || worldIntent.goalId !== episode.goalId
      || worldIntent.planRevision !== episode.planRevision
      // D2 materialization advances episode.worldRevision to the resulting
      // World State revision. The original parent revision remains immutable
      // in the bound APPLY_PARENT_SNAPSHOT Journal entry checked below.
      || preconditions.planRevision !== worldIntent.planRevision
      || preconditions.parentWorldRevision !== worldIntent.parentWorldRevision
    )
  ) return undefined;
  if (!worldIntent && (
    preconditions.planRevision !== undefined
    || preconditions.parentWorldRevision !== undefined
    || preconditions.checks.some((check) => check.id === "MISSION_PARENT_SNAPSHOT_BOUND")
  )) return undefined;

  const referencedJournalIds = [...new Set(preconditions.checks.map((check) => check.reference.id))];
  if (referencedJournalIds.length === 0) return undefined;
  const journalRows = await tx.select().from(aiApplyJournalTable).where(and(
    eq(aiApplyJournalTable.projectId, execution.projectId),
    eq(aiApplyJournalTable.proposalId, proposal.id),
    eq(aiApplyJournalTable.operationId, proposal.operationId ?? ""),
    eq(aiApplyJournalTable.attemptId, attemptId as string),
    inArray(aiApplyJournalTable.id, referencedJournalIds),
  ));
  if (journalRows.length !== referencedJournalIds.length) return undefined;
  const journalById = new Map(journalRows.map((row) => [row.id, row]));
  const payloadFor = (id: string, expectedStage: string): Record<string, unknown> | undefined => {
    const row = journalById.get(id);
    if (
      !row
      || row.stage !== expectedStage
      || canonicalJsonHash(row.payload as Parameters<typeof canonicalJsonHash>[0])
        !== preconditions.checks.find((check) => check.reference.id === id)?.reference.contentHash
    ) return undefined;
    return record(row.payload);
  };
  for (const check of preconditions.checks) {
    const expectedStage = APPLY_PRECONDITION_STAGE_BY_ID[check.id];
    if (check.reference.stage !== expectedStage) return undefined;
    const journal = journalById.get(check.reference.id);
    if (
      !journal
      || journal.stage !== expectedStage
      || canonicalJsonHash(journal.payload as Parameters<typeof canonicalJsonHash>[0])
        !== check.reference.contentHash
    ) return undefined;
  }

  const authorizationChecks = preconditions.checks.filter((check) =>
    check.id === "PROJECT_OWNER_MATCHED" || check.id === "PROPOSAL_ELIGIBLE"
  );
  if (
    authorizationChecks.length !== 2
    || authorizationChecks[0]!.reference.id !== authorizationChecks[1]!.reference.id
  ) return undefined;
  const authorizationPayload = payloadFor(
    authorizationChecks[0]!.reference.id,
    "APPLY_AUTHORIZATION_DECISION",
  );
  const persistedDecision = record(authorizationPayload?.authorizationDecision);
  const proposalEligibility = record(authorizationPayload?.proposalEligibility);
  const persistedDecisionHash = persistedDecision?.decisionHash;
  const persistedDecisionBody = persistedDecision
    ? Object.fromEntries(
        Object.entries(persistedDecision).filter(([key]) => key !== "decisionHash"),
      )
    : undefined;
  if (
    !authorizationPayload
    || !persistedDecision
    || persistedDecisionHash !== authorization.decisionHash
    || !persistedDecisionBody
    || canonicalJsonHash(
      persistedDecisionBody as Parameters<typeof canonicalJsonHash>[0],
    ) !== authorization.decisionHash
    || proposalEligibility?.proposalId !== proposal.id
    || proposalEligibility.status !== "pending"
    || proposalEligibility.approvalRequired !== false
    || proposalEligibility.revision !== proposal.revision
    || authorizationPayload.projectOwnerId !== project.ownerId
    || authorizationPayload.actorUserId !== execution.userId
  ) return undefined;

  const subsetCheck = preconditions.checks.find((check) => check.id === "EXACT_APPROVED_SUBSET");
  const subsetPayload = subsetCheck
    ? payloadFor(subsetCheck.reference.id, "APPLY_APPROVED_SUBSET")
    : undefined;
  if (
    !subsetPayload
    || subsetPayload.proposalId !== proposal.id
    || subsetPayload.proposalRevision !== proposal.revision
    || subsetPayload.proposalChangesHash !== authorization.proposalChangesHash
    || subsetPayload.approvedPathsHash !== authorization.approvedPathsHash
    || subsetPayload.changeSetHash !== proposal.changeSetHash
    // This hashes the user's submitted envelope before partial-Hunk rebasing.
    // V2 binds the exact server-computed digest in the execution request to
    // the Journal payload; the candidate hash above describes final bytes.
    || !digest(subsetPayload.submittedChangeSetHash)
    || (isV2 && subsetPayload.submittedChangeSetHash !== request.submittedChangeSetHash)
    || subsetPayload.subsetAuthorized !== true
  ) return undefined;

  const validationCheck = preconditions.checks.find((check) =>
    check.id === "CANDIDATE_VALIDATION_PASSED"
  );
  const validationPayload = validationCheck
    ? payloadFor(validationCheck.reference.id, "APPLY_VALIDATION_PASSED")
    : undefined;
  const validationReceipts = Array.isArray(validationPayload?.validationReceipts)
    ? validationPayload.validationReceipts
    : [];
  const stabilityCheckForValidation = preconditions.checks.find((check) =>
    check.id === "CANDIDATE_STABLE"
  );
  const stabilityJournalForValidation = stabilityCheckForValidation
    ? journalById.get(stabilityCheckForValidation.reference.id)
    : undefined;
  const stabilityObservedAt = stabilityJournalForValidation?.createdAt instanceof Date
    ? stabilityJournalForValidation.createdAt.getTime()
    : Date.parse(String(stabilityJournalForValidation?.createdAt ?? ""));
  if (
    !validationPayload
    || validationPayload.allPassed !== true
    || validationReceipts.length === 0
    || !Number.isFinite(stabilityObservedAt)
    || validationReceipts.some((value) => {
      const receipt = record(value);
      const evidence = record(receipt?.evidence);
      const observedAt = typeof evidence?.observedAt === "string"
        ? Date.parse(evidence.observedAt)
        : Number.NaN;
      const profile = typeof receipt?.profile === "string" ? receipt.profile.trim() : "";
      return receipt?.status !== "passed"
        || !profile
        || !Number.isFinite(observedAt)
        || observedAt > stabilityObservedAt
        || (typeof evidence?.validatorProfile === "string"
          && evidence.validatorProfile !== profile)
        || typeof evidence?.evidenceId !== "string"
        || !evidence.evidenceId.trim()
        || typeof evidence.artifactRef !== "string"
        || !evidence.artifactRef.trim()
        || evidence.operationId !== proposal.operationId
        || evidence.projectRevision !== sourceRevision
        || evidence.baseTreeHash !== proposal.baseTreeHash
        || evidence.candidateHash !== proposal.candidateTreeHash
        || evidence.changeSetHash !== proposal.changeSetHash
        || evidence.treeDigestVersion !== proposal.treeDigestVersion;
    })
    || validationPayload.baseTreeHash !== proposal.baseTreeHash
    || validationPayload.candidateTreeHash !== proposal.candidateTreeHash
    || validationPayload.changeSetHash !== proposal.changeSetHash
    || validationPayload.treeDigestVersion !== proposal.treeDigestVersion
  ) return undefined;

  const stabilityChecks = preconditions.checks.filter((check) =>
    check.id === "CANDIDATE_STABLE" || check.id === "LIVE_ROOT_BASE_MATCHED"
  );
  if (
    stabilityChecks.length !== 2
    || stabilityChecks[0]!.reference.id !== stabilityChecks[1]!.reference.id
  ) return undefined;
  const stabilityCheck = stabilityChecks[0];
  const stabilityPayload = stabilityCheck
    ? payloadFor(stabilityCheck.reference.id, "APPLY_CANDIDATE_STABLE")
    : undefined;
  if (
    !stabilityPayload
    || stabilityPayload.candidateHashAfterValidation !== proposal.candidateTreeHash
    || stabilityPayload.candidateHashBeforePromotion !== proposal.candidateTreeHash
    || stabilityPayload.liveRootHashBeforePromotion !== proposal.baseTreeHash
    || stabilityPayload.baseTreeHash !== proposal.baseTreeHash
    || stabilityPayload.candidateTreeHash !== proposal.candidateTreeHash
    || stabilityPayload.candidateStable !== true
    || stabilityPayload.liveRootBaseMatched !== true
  ) return undefined;

  const leaseCheck = preconditions.checks.find((check) => check.id === "EXECUTION_LEASE_OWNED");
  const leasePayload = leaseCheck
    ? payloadFor(leaseCheck.reference.id, "APPLY_EXECUTION_LEASE")
    : undefined;
  const leaseUntil = typeof leasePayload?.leaseUntil === "string"
    ? Date.parse(leasePayload.leaseUntil)
    : Number.NaN;
  const leaseObservedAt = typeof leasePayload?.observedAt === "string"
    ? Date.parse(leasePayload.observedAt)
    : Number.NaN;
  const requestedEventAt = requestedEvent.createdAt instanceof Date
    ? requestedEvent.createdAt.getTime()
    : Date.parse(String(requestedEvent.createdAt));
  const actionEvent = record(requestedPayload.action);
  if (
    !leasePayload
    || leasePayload.executionId !== execution.id
    || leasePayload.attempt !== execution.attempt
    || leasePayload.userId !== execution.userId
    || typeof leasePayload.workerId !== "string"
    || leasePayload.workerId !== requestedEvent.actorId
    || requestedEvent.actorType !== "worker"
    || !Number.isFinite(leaseUntil)
    || !Number.isFinite(leaseObservedAt)
    || !Number.isFinite(requestedEventAt)
    || leaseObservedAt > leaseUntil
    || leaseObservedAt > requestedEventAt
    || requestedEventAt > leaseUntil
    || (execution.status === "running" && execution.workerId !== leasePayload.workerId)
    || actionEvent?.actionId !== actionId
  ) return undefined;

  if (worldIntent) {
    const parentCheck = preconditions.checks.find((check) =>
      check.id === "MISSION_PARENT_SNAPSHOT_BOUND"
    );
    const parentPayload = parentCheck
      ? payloadFor(parentCheck.reference.id, "APPLY_PARENT_SNAPSHOT")
      : undefined;
    const persistedIntent = record(parentPayload?.worldTransitionIntent);
    if (
      !parentPayload
      || typeof parentPayload.missionId !== "string"
      || parentPayload.goalId !== worldIntent.goalId
      || parentPayload.missionId !== episode.missionId
      || execution.goalId !== worldIntent.goalId
      || !persistedIntent
      || canonicalJsonHash(persistedIntent as Parameters<typeof canonicalJsonHash>[0])
        !== canonicalJsonHash(worldIntent as Parameters<typeof canonicalJsonHash>[0])
    ) return undefined;
  }

  return {
    authorizationDecisionHash: authorization.decisionHash,
    preconditionReceiptHash: preconditions.receiptHash,
    preconditionJournalIds: [...referencedJournalIds].sort(),
  };
}

export function isCommittedApplyProposalProofBound(
  proposal: unknown,
  candidateTreeHash: unknown,
): boolean {
  const value = record(proposal);
  if (
    !value
    || !digest(candidateTreeHash)
    || value.status !== "applied"
    || value.lifecycle !== "committed"
  ) return false;
  const commitHash = value.commitHash;
  const committedTreeHash = value.committedTreeHash;
  return typeof commitHash === "string"
    && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitHash)
    && committedTreeHash === candidateTreeHash
    && committedTreeHash === value.promotedTreeHash;
}

/**
 * Reconstruct Apply proof only from the durable action, observed effect, and
 * the exact before/after observations that the effect verifier accepted.
 * Mission D2's project-scoped observations remain a separate transition gate.
 */
export async function deriveApplyChangesProof(input: {
  tx: ApplyChangesProofTransaction;
  execution: typeof aiExecutionsTable.$inferSelect;
  request: Record<string, unknown> | undefined;
  sourceRevision: string | null;
  candidateIdentity: string | null;
  effectBundleId: string | null;
  allowCompleted?: boolean;
}): Promise<ApplyChangesProofArtifact | undefined> {
  const { tx, execution, request } = input;
  if (
    !isApplyChangesProofMode(request?.applyChangesProofMode)
    || request.proofRequired !== true
    || request.effectRequired !== true
    || request.turnIntent !== "APPLY_CHANGES"
    || execution.status !== "running"
      && !(input.allowCompleted && execution.status === "completed")
  ) return undefined;

  const operationId = execution.operationId;
  const isV2 = request.applyChangesProofMode === APPLY_CHANGES_PROOF_MODE_V2;
  const requestedOperationId = request.operationId;
  const attemptId = isV2 ? request.applyAttemptId : requestedOperationId;
  const proposalId = execution.proposalId;
  const sourceRevision = input.sourceRevision;
  const candidateIdentity = input.candidateIdentity;
  if (
    !operationId
    || typeof requestedOperationId !== "string"
    || !requestedOperationId.trim()
    || requestedOperationId !== operationId
    || typeof attemptId !== "string"
    || !attemptId.trim()
    || (isV2 && !digest(request.submittedChangeSetHash))
    || !proposalId
    || typeof execution.workspaceRoot !== "string"
    || !execution.workspaceRoot
    || request.workspaceRoot !== execution.workspaceRoot
    || typeof request.workspaceRevision !== "string"
    || request.workspaceRevision !== sourceRevision
    || sourceRevision !== execution.baseRevision
    || !candidateIdentity
    || !input.effectBundleId
    || !Array.isArray(request.validationTargetPaths)
    || request.validationTargetPaths.length === 0
    || request.validationTargetPaths.some((item) =>
      typeof item !== "string" || !item.trim()
    )
  ) return undefined;

  const [proposal] = await tx.select().from(aiChangeProposalsTable).where(and(
    eq(aiChangeProposalsTable.id, proposalId),
    eq(aiChangeProposalsTable.projectId, execution.projectId),
  )).for("update").limit(1);
  if (
    !proposal
    || proposal.status !== "applied"
    || (
      proposal.lifecycle !== "blocked"
      && proposal.lifecycle !== "applied"
      && !isCommittedApplyProposalProofBound(proposal, proposal.candidateTreeHash)
    )
    || proposal.operationId !== execution.correlationId
    || typeof proposal.baseRevision !== "string"
    || proposal.baseRevision !== sourceRevision
    || !digest(proposal.baseTreeHash)
    || !digest(proposal.candidateTreeHash)
    || !digest(proposal.changeSetHash)
    || proposal.promotedTreeHash !== proposal.candidateTreeHash
    || candidateIdentity !== `${proposal.id}:${proposal.candidateTreeHash}`
  ) return undefined;

  const [episode] = await tx.select().from(aiAgentEpisodesTable).where(and(
    eq(aiAgentEpisodesTable.projectId, execution.projectId),
    eq(aiAgentEpisodesTable.executionId, execution.id),
    eq(aiAgentEpisodesTable.attempt, execution.attempt),
  )).for("update").limit(1);
  const episodeIsVerifying = episode?.state === "verifying" && !episode.closedAt;
  const episodeWasProven = episode?.state === "completed"
    && Boolean(episode.closedAt)
    && episode.verdict === "achieved"
    && episode.reasonCode === "CANONICAL_PROOF_PROVEN";
  if (
    !episode
    || episode.intentKind !== "APPLY_CHANGES"
    || episode.projectRevision !== sourceRevision
    || (!episodeIsVerifying && !(input.allowCompleted && episodeWasProven))
  ) return undefined;

  const actionId = `action:${execution.id}:${execution.attempt}:apply`;
  const beforeRef = `apply:${execution.id}:${execution.attempt}:before`;
  const afterRef = `apply:${execution.id}:${execution.attempt}:after`;
  const action = buildApplyChangeAction({
    actionId,
    episodeId: episode.id,
    projectId: execution.projectId,
    operationId: proposal.operationId ?? "",
    proposalId,
    attemptId,
    sourceRevision,
    baseTreeHash: proposal.baseTreeHash,
    candidateTreeHash: proposal.candidateTreeHash,
    changeSetHash: proposal.changeSetHash,
    approvedPaths: request.validationTargetPaths as string[],
  });
  const actionHash = canonicalJsonHash(action);
  const effectContract = buildApplyChangeEffectContract({
    candidateIdentity,
    candidateTreeHash: proposal.candidateTreeHash,
    beforeEvidenceRef: beforeRef,
    afterEvidenceRef: afterRef,
  });
  const effectContractHash = hashEffectContract(effectContract);

  const events = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
    eq(aiAgentEpisodeEventsTable.projectId, execution.projectId),
    eq(aiAgentEpisodeEventsTable.executionId, execution.id),
    eq(aiAgentEpisodeEventsTable.attempt, execution.attempt),
    eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
  ));
  const requestedEvents = events.filter((event) => (
    event.eventType === "ACTION_REQUESTED"
    && record(event.payload)?.actionId === actionId
  ));
  const committedEvents = events.filter((event) => (
    event.eventType === "ACTION_COMMITTED"
    && record(event.payload)?.actionId === actionId
  ));
  if (requestedEvents.length !== 1 || committedEvents.length !== 1) return undefined;
  const requestedPayload = record(requestedEvents[0]!.payload);
  const committedPayload = record(committedEvents[0]!.payload);
  if (
    !requestedPayload
    || !committedPayload
    || canonicalJsonHash(record(requestedPayload.action) as never) !== actionHash
    || canonicalJsonHash(record(requestedPayload.effectContract) as never)
      !== canonicalJsonHash(effectContract)
    || requestedPayload.capabilityId !== APPLY_CHANGE_CAPABILITY_ID
    || requestedEvents[0]!.payloadHash !== canonicalJsonHash(requestedPayload as never)
    || committedPayload.status !== "promoted"
    || committedPayload.afterTreeHash !== proposal.candidateTreeHash
    || committedEvents[0]!.payloadHash !== canonicalJsonHash(committedPayload as never)
  ) return undefined;

  const [bundle] = await tx.select().from(aiAgentEffectBundlesTable).where(and(
    eq(aiAgentEffectBundlesTable.id, input.effectBundleId),
    eq(aiAgentEffectBundlesTable.projectId, execution.projectId),
    eq(aiAgentEffectBundlesTable.executionId, execution.id),
    eq(aiAgentEffectBundlesTable.attempt, execution.attempt),
    eq(aiAgentEffectBundlesTable.episodeId, episode.id),
  )).for("update").limit(1);
  if (!bundle || bundle.verdict !== "OBSERVED") return undefined;
  const effectIds = stringArray(bundle.effectIds);
  if (!effectIds || effectIds.length !== 1) return undefined;
  const [effect] = await tx.select().from(aiAgentEffectsTable).where(and(
    eq(aiAgentEffectsTable.id, effectIds[0]!),
    eq(aiAgentEffectsTable.projectId, execution.projectId),
    eq(aiAgentEffectsTable.executionId, execution.id),
    eq(aiAgentEffectsTable.attempt, execution.attempt),
    eq(aiAgentEffectsTable.episodeId, episode.id),
  )).for("update").limit(1);
  if (
    !effect
    || effect.actionId !== actionId
    || effect.capabilityId !== APPLY_CHANGE_CAPABILITY_ID
    || effect.status !== "observed"
    || effect.effectContractHash !== effectContractHash
    || canonicalJsonHash(effect.expectedEffects as never)
      !== canonicalJsonHash(effectContract.expectedStateChanges as never)
    || canonicalJsonHash(bundle.effectContractHashes as never)
      !== canonicalJsonHash([effectContractHash])
  ) return undefined;
  const effectEvidenceRefs = stringArray(effect.evidenceRefs);
  if (!effectEvidenceRefs?.includes(beforeRef) || !effectEvidenceRefs.includes(afterRef)) {
    return undefined;
  }

  const beforeObservationIds = stringArray(effect.beforeObservationIds);
  const afterObservationIds = stringArray(effect.afterObservationIds);
  if (
    !beforeObservationIds
    || beforeObservationIds.length !== 1
    || !afterObservationIds
    || afterObservationIds.length !== 1
    || beforeObservationIds[0] === afterObservationIds[0]
  ) return undefined;
  const allObservationIds = [...beforeObservationIds, ...afterObservationIds];
  const observations = await tx.select().from(aiAgentObservationsTable).where(and(
    eq(aiAgentObservationsTable.projectId, execution.projectId),
    inArray(aiAgentObservationsTable.id, allObservationIds),
  )).for("update");
  if (observations.length !== 2) return undefined;
  const before = observations.find((row) => row.id === beforeObservationIds[0]);
  const after = observations.find((row) => row.id === afterObservationIds[0]);
  const validObservation = (
    row: typeof aiAgentObservationsTable.$inferSelect | undefined,
    expectedSourceId: string,
    expectedHash: string,
  ) => Boolean(
    row
    && row.executionId === execution.id
    && row.episodeId === episode.id
    && row.sourceId === expectedSourceId
    && row.projectRevision === sourceRevision
    && row.subject === `project:${candidateIdentity}`
    && row.predicate === "workspace.tree_hash"
    && treeHash(row.value) === expectedHash
    && row.provenance === "DIRECT_OBSERVATION"
    && row.sourceType === "direct_observation"
    && row.completeness === "complete"
    && row.freshness === "fresh"
  );
  if (
    !validObservation(before, `${beforeRef}:tree`, proposal.baseTreeHash)
    || !validObservation(after, `${afterRef}:tree`, proposal.candidateTreeHash)
  ) return undefined;

  const baseArtifact: ApplyChangesProofArtifactBase = {
    kind: "apply_changes",
    executionId: execution.id,
    attempt: execution.attempt,
    operationId,
    proposalId,
    proposalOperationId: proposal.operationId ?? "",
    sourceRevision,
    candidateIdentity,
    baseTreeHash: proposal.baseTreeHash,
    candidateTreeHash: proposal.candidateTreeHash,
    changeSetHash: proposal.changeSetHash,
    episodeId: episode.id,
    actionId,
    actionEventId: requestedEvents[0]!.id,
    committedEventId: committedEvents[0]!.id,
    effectBundleId: bundle.id,
    effectId: effect.id,
    actionHash,
    effectContractHash,
    beforeObservationIds,
    afterObservationIds,
  };
  if (request.applyChangesProofMode === APPLY_CHANGES_PROOF_MODE_V2) {
    const v2Evidence = await deriveApplyChangesProofV2Evidence({
      tx,
      execution,
      proposal,
      episode,
      request,
      requestedPayload,
      actionId,
      requestedEvent: requestedEvents[0]!,
      sourceRevision,
      candidateIdentity,
    });
    if (!v2Evidence) return undefined;
    return { ...baseArtifact, version: 2, ...v2Evidence };
  }
  return { ...baseArtifact, version: 1 };
}