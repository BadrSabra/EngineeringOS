import { and, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentObservationsTable,
  aiChangeProposalsTable,
  aiExecutionsTable,
} from "@workspace/db";
import { canonicalJsonHash, hashEffectContract } from "@workspace/ai-orchestrator";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  buildApplyChangeAction,
  buildApplyChangeEffectContract,
} from "./apply-change-effect.js";

export const APPLY_CHANGES_PROOF_MODE = "apply_changes_v1" as const;

export type ApplyChangesProofArtifact = {
  kind: "apply_changes";
  version: 1;
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
    request?.applyChangesProofMode !== APPLY_CHANGES_PROOF_MODE
    || request.proofRequired !== true
    || request.effectRequired !== true
    || request.turnIntent !== "APPLY_CHANGES"
    || execution.status !== "running"
      && !(input.allowCompleted && execution.status === "completed")
  ) return undefined;

  const operationId = execution.operationId;
  const attemptId = request.operationId;
  const proposalId = execution.proposalId;
  const sourceRevision = input.sourceRevision;
  const candidateIdentity = input.candidateIdentity;
  if (
    !operationId
    || typeof attemptId !== "string"
    || !attemptId
    || attemptId !== operationId
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
    || (proposal.lifecycle !== "blocked" && proposal.lifecycle !== "applied")
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

  return {
    kind: "apply_changes",
    version: 1,
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
}