import { and, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentObservationsTable,
  aiExecutionsTable,
} from "@workspace/db";
import { canonicalJsonHash, hashEffectContract } from "@workspace/ai-orchestrator";
import { buildGateCAction, buildGateCEffectContract, gateCEffectIdentity } from "./agent-state/gate-c-effect.js";

export const RUNTIME_START_GATE_C_PROOF_MODE = "runtime_start_gate_c_v1" as const;

export type RuntimeStartGateCProofArtifact = {
  kind: "runtime_start_gate_c";
  version: 1;
  executionId: string;
  attempt: number;
  operationId: string;
  sourceRevision: string;
  workspaceIdentity: string;
  candidateIdentity: string | null;
  episodeId: string;
  actionId: string;
  actionEventId: string;
  committedEventId: string;
  effectBundleId: string;
  effectId: string;
  actionHash: string;
  effectContractHash: string;
  environmentRevision: string;
  beforeObservationIds: string[];
  afterObservationIds: string[];
};

type RuntimeStartProofTransaction = Parameters<Parameters<typeof import("@workspace/db").db.transaction>[0]>[0];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    return undefined;
  }
  return value as string[];
}

function sameStrings(left: unknown, right: readonly string[]): boolean {
  const values = stringArray(left);
  return Boolean(values && values.length === right.length && values.every((value, index) => value === right[index]));
}

function revision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validObservation(
  row: typeof aiAgentObservationsTable.$inferSelect | undefined,
  input: {
    projectId: string;
    executionId: string;
    episodeId: string;
    sourceRevision: string;
    environmentRevision: string;
  },
): row is typeof aiAgentObservationsTable.$inferSelect {
  return Boolean(
    row
    && row.projectId === input.projectId
    && row.executionId === input.executionId
    && row.episodeId === input.episodeId
    && row.projectRevision === input.sourceRevision
    && row.environmentRevision === input.environmentRevision
    && row.provenance === "DIRECT_OBSERVATION"
    && row.sourceType === "direct_observation"
    && row.completeness === "complete"
    && row.freshness === "fresh"
    && row.environmentFreshness === "fresh",
  );
}

/**
 * Derive a narrowly-scoped runtime.start proof from durable Gate C rows.
 * This is deliberately independent of the post-acceptance World State
 * transition: that transition is a separate projection, not the proof source.
 */
export async function deriveRuntimeStartGateCProof(input: {
  tx: RuntimeStartProofTransaction;
  execution: typeof aiExecutionsTable.$inferSelect;
  request: Record<string, unknown> | undefined;
  recipeReceipt: unknown;
  sourceRevision: string | null;
  candidateIdentity: string | null;
  effectBundleId: string | null;
  allowCompleted?: boolean;
}): Promise<RuntimeStartGateCProofArtifact | undefined> {
  const { tx, execution, request } = input;
  if (
    request?.recipeProofMode !== RUNTIME_START_GATE_C_PROOF_MODE
    || execution.status !== "running" && !(input.allowCompleted && execution.status === "completed")
  ) return undefined;

  const operationId = execution.operationId;
  const rootPath = execution.workspaceRoot;
  const sourceRevision = input.sourceRevision;
  const candidateIdentity = input.candidateIdentity;
  if (
    !operationId
    || request.operationId !== operationId
    || !rootPath
    || request.workspaceRoot !== rootPath
    || !sourceRevision
    || !revision(sourceRevision)
    || sourceRevision !== request.workspaceRevision
    || sourceRevision !== execution.baseRevision
    || !input.effectBundleId
    || candidateIdentity !== null && !digest(candidateIdentity)
  ) return undefined;

  const receipt = record(input.recipeReceipt);
  if (
    !receipt
    || receipt.status !== "completed"
    || receipt.recipeId !== "runtime.start"
    || receipt.recipeVersion !== 1
    || receipt.executionId !== execution.id
    || receipt.attempt !== execution.attempt
    || receipt.operationId !== operationId
    || receipt.sourceRevision !== sourceRevision
  ) return undefined;

  const [episode] = await tx.select().from(aiAgentEpisodesTable).where(and(
    eq(aiAgentEpisodesTable.projectId, execution.projectId),
    eq(aiAgentEpisodesTable.executionId, execution.id),
    eq(aiAgentEpisodesTable.attempt, execution.attempt),
  )).limit(1);
  if (
    !episode
    || episode.projectRevision !== sourceRevision
    || !input.allowCompleted && episode.closedAt
    || (input.allowCompleted
      ? episode.state !== "completed"
        || episode.verdict !== "achieved"
        || episode.reasonCode !== "CANONICAL_PROOF_PROVEN"
      : episode.state !== "verifying")
  ) return undefined;

  const rawTargetPaths = stringArray(request.validationTargetPaths ?? []);
  if (!rawTargetPaths) return undefined;
  const actionId = `action:${execution.id}:${execution.attempt}:gate-c`;
  const action = buildGateCAction({
    actionId,
    episodeId: episode.id,
    projectId: execution.projectId,
    operationId,
    sourceRevision,
    recipeId: "runtime.start",
    capabilityId: "runtime.start",
    approvedPaths: rawTargetPaths,
    ...(candidateIdentity ? { candidateIdentity } : {}),
  });
  const actionHash = canonicalJsonHash(action);
  const actionContractHash = canonicalJsonHash({
    contractVersion: 1,
    triggerConditions: action.triggerConditions ?? [],
    preconditions: action.preconditions,
    expectedEffects: action.expectedEffects,
    observationProfile: action.observationProfile,
    failureSemantics: action.failureSemantics,
  });
  const beforeRef = `gate-c:${execution.id}:${execution.attempt}:before`;
  const afterRef = `gate-c:${execution.id}:${execution.attempt}:after`;
  const effectContract = buildGateCEffectContract({
    kind: "runtime",
    operationId,
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
  const actionPayload = record(requestedEvents[0]!.payload);
  const committedPayload = record(committedEvents[0]!.payload);
  const storedAction = record(actionPayload?.action);
  const storedActionContract = record(actionPayload?.actionContract);
  if (
    !actionPayload
    || !storedAction
    || !storedActionContract
    || canonicalJsonHash(storedAction as never) !== actionHash
    || actionPayload.actionContractHash !== actionContractHash
    || canonicalJsonHash(storedActionContract as never) !== actionContractHash
    || actionPayload.capabilityId !== "runtime.start"
    || requestedEvents[0]!.payloadHash !== canonicalJsonHash(actionPayload as never)
    || !committedPayload
    || committedPayload.status !== "passed"
    || committedEvents[0]!.payloadHash !== canonicalJsonHash(committedPayload as never)
  ) return undefined;

  const [bundle] = await tx.select().from(aiAgentEffectBundlesTable).where(and(
    eq(aiAgentEffectBundlesTable.id, input.effectBundleId),
    eq(aiAgentEffectBundlesTable.projectId, execution.projectId),
    eq(aiAgentEffectBundlesTable.executionId, execution.id),
    eq(aiAgentEffectBundlesTable.attempt, execution.attempt),
    eq(aiAgentEffectBundlesTable.episodeId, episode.id),
  )).limit(1);
  if (!bundle || bundle.verdict !== "OBSERVED") return undefined;
  const effectIds = stringArray(bundle.effectIds);
  if (!effectIds || effectIds.length !== 1) return undefined;
  const [effect] = await tx.select().from(aiAgentEffectsTable).where(and(
    eq(aiAgentEffectsTable.id, effectIds[0]!),
    eq(aiAgentEffectsTable.projectId, execution.projectId),
    eq(aiAgentEffectsTable.executionId, execution.id),
    eq(aiAgentEffectsTable.attempt, execution.attempt),
    eq(aiAgentEffectsTable.episodeId, episode.id),
  )).limit(1);
  if (!effect) return undefined;
  if (
    effect.actionId !== actionId
    || effect.capabilityId !== "runtime.start"
    || effect.status !== "observed"
  ) return undefined;
  if (effect.effectContractHash !== effectContractHash) return undefined;
  if (canonicalJsonHash(effect.expectedEffects as never)
    !== canonicalJsonHash(effectContract.expectedStateChanges as never)) {
    return undefined;
  }
  if (!sameStrings(bundle.effectContractHashes, [effectContractHash])) {
    return undefined;
  }
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
    || afterObservationIds.length < 2
    || new Set([...beforeObservationIds, ...afterObservationIds]).size
      !== beforeObservationIds.length + afterObservationIds.length
  ) return undefined;
  const identity = gateCEffectIdentity({ kind: "runtime", operationId });
  const allObservationIds = [...beforeObservationIds, ...afterObservationIds];
  const observationRows = await tx.select().from(aiAgentObservationsTable).where(and(
    eq(aiAgentObservationsTable.projectId, execution.projectId),
    inArray(aiAgentObservationsTable.id, allObservationIds),
  ));
  if (observationRows.length !== allObservationIds.length) return undefined;
  const observations = new Map(observationRows.map((row) => [row.id, row]));
  const gateBefore = observations.get(beforeObservationIds[0]!);
  const servingBeforeSourceId = `${beforeRef}:${identity.subject}:${identity.predicate}`;
  const servingBefore = observationRows.find((row) => row.sourceId === servingBeforeSourceId);
  const servingAfter = observationRows.find((row) => (
    row.sourceId === `${afterRef}:${identity.subject}:${identity.predicate}`
  ));
  const runtimeAfter = observationRows.find((row) => row.sourceId === `${afterRef}:runtime.after_state`);
  const runtimeStatus = observationRows.find((row) => row.sourceId === `${afterRef}:runtime.status`);
  const rawBeforeStateId = `runtime-start:${execution.id}:${execution.attempt}:${actionId}:before:runtime.before_state`;
  const [runtimeBefore] = await tx.select().from(aiAgentObservationsTable).where(and(
    eq(aiAgentObservationsTable.projectId, execution.projectId),
    eq(aiAgentObservationsTable.executionId, execution.id),
    eq(aiAgentObservationsTable.sourceId, rawBeforeStateId),
  )).limit(1);

  const state = record(runtimeAfter?.value);
  const afterState = record(state?.after);
  const listener = record(afterState?.listener);
  const processAttestation = record(listener?.processAttestation);
  const environmentRevision = typeof runtimeAfter?.environmentRevision === "string"
    ? runtimeAfter.environmentRevision
    : "";
  const beforeState = record(runtimeBefore?.value);
  if (!runtimeAfter || !runtimeStatus || !servingBefore || !runtimeBefore) {
    return undefined;
  }
  const observationBinding = {
    projectId: execution.projectId,
    executionId: execution.id,
    episodeId: episode.id,
    sourceRevision,
    environmentRevision,
  };
  if (!validObservation(gateBefore, observationBinding)) return undefined;
  if (
    gateBefore.sourceId !== servingBeforeSourceId
    || gateBefore.predicate !== identity.predicate
    || gateBefore.value !== "pending"
  ) return undefined;
  if (!validObservation(servingBefore, observationBinding)) {
    return undefined;
  }
  if (servingBefore.value !== "pending") return undefined;
  if (!beforeState || beforeState.status !== "observed") return undefined;
  if (
    !validObservation(runtimeBefore, observationBinding)
    || runtimeBefore.sourceId !== rawBeforeStateId
    || runtimeBefore.predicate !== "runtime.before_state"
    || !["stopped", "running"].includes(String(beforeState.runtimeStatus))
    || beforeState.projectId !== execution.projectId
    || beforeState.revision !== sourceRevision
    || beforeState.environmentRevision !== environmentRevision
    || !["supervisor_inventory", "managed_session", "test_observer"]
      .includes(String(beforeState.source))
    || beforeState.inventoryComplete !== true
    || !Array.isArray(beforeState.unknownListenerPorts)
    || beforeState.unknownListenerPorts.length !== 0
    || typeof beforeState.observedAt !== "string"
    || !Number.isFinite(Date.parse(beforeState.observedAt))
  ) return undefined;
  if (!/^env-v1:[a-f0-9]{64}$/.test(environmentRevision)) return undefined;
  if (
    !validObservation(runtimeAfter, observationBinding)
    || runtimeAfter.sourceId !== `${afterRef}:runtime.after_state`
    || runtimeAfter.predicate !== "runtime.after_state"
  ) return undefined;
  if (
    !validObservation(runtimeStatus, observationBinding)
    || runtimeStatus.predicate !== "runtime.status"
    || runtimeStatus.value !== "running"
    || runtimeAfter.subject !== `runtime:${String(afterState?.sessionId ?? "")}`
  ) return undefined;
  if (
    !validObservation(servingAfter, observationBinding)
    || servingAfter.value !== "passed"
  ) return undefined;
  if (
    !afterState
    || afterState.status !== "passed"
    || afterState.projectId !== execution.projectId
    || afterState.revision !== sourceRevision
    || typeof afterState.sessionId !== "string"
    || !afterState.sessionId.trim()
    || afterState.processAlive !== true
    || afterState.portReady !== true
    || !Number.isInteger(afterState.pid)
    || !Number.isInteger(afterState.port)
    || typeof afterState.observedAt !== "string"
    || !Number.isFinite(Date.parse(afterState.observedAt))
  ) return undefined;
  if (!listener || listener.status !== "known" || listener.port !== afterState.port) {
    return undefined;
  }
  if (
    !processAttestation
    || processAttestation.status !== "known"
    || !digest(processAttestation.bindingDigest)
    || !digest(processAttestation.attestationDigest)
    || !digest(processAttestation.processEnvironmentDigest)
  ) return undefined;
  if (
    !afterObservationIds.includes(runtimeAfter.id)
    || !afterObservationIds.includes(runtimeStatus.id)
    || !afterObservationIds.includes(servingAfter.id)
  ) return undefined;

  const workspaceIdentity = canonicalJsonHash({
    projectId: execution.projectId,
    operationId,
    rootPath,
    sourceRevision,
    candidateIdentity,
  });
  return {
    kind: "runtime_start_gate_c",
    version: 1,
    executionId: execution.id,
    attempt: execution.attempt,
    operationId,
    sourceRevision,
    workspaceIdentity,
    candidateIdentity,
    episodeId: episode.id,
    actionId,
    actionEventId: requestedEvents[0]!.id,
    committedEventId: committedEvents[0]!.id,
    effectBundleId: bundle.id,
    effectId: effect.id,
    actionHash,
    effectContractHash,
    environmentRevision,
    beforeObservationIds: [...beforeObservationIds, runtimeBefore.id],
    afterObservationIds,
  };
}