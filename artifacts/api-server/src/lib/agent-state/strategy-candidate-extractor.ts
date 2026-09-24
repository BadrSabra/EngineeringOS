import { and, asc, eq, inArray } from "drizzle-orm";
import {
  AgentEffectSchema,
  AgentObservationSchema,
  StrategyCandidateSchema,
  canonicalJsonHash,
  type JsonValue,
  type StrategyCandidate,
} from "@workspace/ai-orchestrator";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiStrategyCandidatesTable,
  db,
} from "@workspace/db";
import { loadCanonicalProof } from "../proof-foundation.js";

type StrategyExtractionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type StrategyExtractionResult =
  | {
      status: "stored";
      candidate: StrategyCandidate;
      candidateHash: string;
      created: boolean;
    }
  | {
      status: "not_eligible";
      reason:
        | "episode_not_found"
        | "episode_not_accepted"
        | "execution_identity_mismatch"
        | "acceptance_not_proven"
        | "missing_effect_bundle"
        | "effect_bundle_mismatch"
        | "event_stream_invalid"
        | "event_identity_mismatch"
        | "event_actor_mismatch"
        | "event_payload_hash_mismatch"
        | "terminal_event_invalid"
        | "unsupported_action_trace"
        | "effect_evidence_incomplete"
        | "candidate_evaluation_started";
    };

type AcceptedAction = {
  actionId: string;
  capabilityId: string;
  expectedEffects: string[];
  triggerConditions: JsonValue[];
  preconditions: string[];
  observationProfile: string;
  failureSemantics: string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function actionRequest(value: unknown): AcceptedAction | undefined {
  const record = asRecord(value);
  const expectedEffects = record?.expectedEffects;
  const contract = asRecord(record?.actionContract);
  const triggers = contract?.triggerConditions;
  const preconditions = contract?.preconditions;
  const contractEffects = contract?.expectedEffects;
  const failureSemantics = contract?.failureSemantics;
  if (
    typeof record?.actionId !== "string"
    || !record.actionId.trim()
    || typeof record.capabilityId !== "string"
    || !record.capabilityId.trim()
    || !Array.isArray(expectedEffects)
    || expectedEffects.length === 0
    || !expectedEffects.every((effect) => typeof effect === "string" && effect.trim().length > 0)
    || !contract
    || contract.contractVersion !== 1
    || typeof record.actionContractHash !== "string"
    || record.actionContractHash !== canonicalJsonHash(contract as unknown as JsonValue)
    || !Array.isArray(triggers)
    || triggers.length === 0
    || !Array.isArray(preconditions)
    || preconditions.length === 0
    || !preconditions.every((condition) => typeof condition === "string" && condition.trim().length > 0)
    || !Array.isArray(contractEffects)
    || contractEffects.length !== expectedEffects.length
    || !contractEffects.every((effect, index) => effect === expectedEffects[index])
    || typeof contract.observationProfile !== "string"
    || !contract.observationProfile.trim()
    || !Array.isArray(failureSemantics)
    || failureSemantics.length === 0
    || !failureSemantics.every((value) => typeof value === "string" && value.trim().length > 0)
  ) {
    return undefined;
  }
  return {
    actionId: record.actionId,
    capabilityId: record.capabilityId,
    expectedEffects: expectedEffects as string[],
    triggerConditions: triggers as JsonValue[],
    preconditions: preconditions as string[],
    observationProfile: contract.observationProfile,
    failureSemantics: failureSemantics as string[],
  };
}

function actionCommitMatches(value: unknown, action: AcceptedAction): boolean {
  const record = asRecord(value);
  return record?.actionId === action.actionId
    && record.capabilityId === action.capabilityId
    && (record.status === "completed" || record.status === "passed");
}

function rowToObservation(row: typeof aiAgentObservationsTable.$inferSelect) {
  return AgentObservationSchema.safeParse({
    schemaVersion: "1",
    observationId: row.id,
    projectId: row.projectId,
    executionId: row.executionId,
    episodeId: row.episodeId,
    kind: "EXTERNAL",
    provenance: row.provenance,
    observationRole: row.observationRole,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    ...(row.sourceVersion ? { sourceVersion: row.sourceVersion } : {}),
    subject: row.subject,
    predicate: row.predicate,
    value: row.value as JsonValue,
    sourceRefs: Array.isArray(row.sourceRefs)
      ? row.sourceRefs.filter((value): value is string => typeof value === "string")
      : [],
    observedAt: row.observedAt.toISOString(),
    ...(row.projectRevision ? { projectRevision: row.projectRevision } : {}),
    ...(row.environmentRevision ? { environmentRevision: row.environmentRevision } : {}),
    completeness: row.completeness,
    freshness: row.freshness,
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? row.evidenceRefs.filter((value): value is string => typeof value === "string")
      : [],
  });
}

function normalizedEffectSignature(
  effect: ReturnType<typeof AgentEffectSchema.parse>,
): Array<{ subject: string; predicate: string }> | undefined {
  if (!Array.isArray(effect.expectedEffects) || effect.expectedEffects.length === 0) return undefined;
  const changes = effect.expectedEffects.map((value: unknown) => {
    const record = asRecord(value);
    if (
      typeof record?.subject !== "string"
      || !record.subject.trim()
      || typeof record.predicate !== "string"
      || !record.predicate.trim()
    ) {
      return undefined;
    }
    return { subject: record.subject, predicate: record.predicate };
  });
  if (changes.some((change: { subject: string; predicate: string } | undefined) => !change)) {
    return undefined;
  }
  return (changes as Array<{ subject: string; predicate: string }>)
    .sort((left, right) =>
      left.subject.localeCompare(right.subject) || left.predicate.localeCompare(right.predicate));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function persistedEventPayloadHash(row: typeof aiAgentEpisodeEventsTable.$inferSelect): string {
  const payload = asRecord(row.payload);
  if (row.eventType === "EFFECT_CLASSIFIED" && payload) {
    // The effect observer's legacy deduplication hash covers its stable
    // identity projection, while the payload also retains observation refs.
    return canonicalJsonHash({
      effectId: payload.effectId,
      effectBundleId: payload.effectBundleId,
      actionId: payload.actionId,
      status: payload.status,
    } as unknown as JsonValue);
  }
  return canonicalJsonHash(row.payload as JsonValue);
}

function candidateStaticHash(candidate: StrategyCandidate): string {
  return canonicalJsonHash({
    candidateId: candidate.candidateId,
    triggerConditions: candidate.triggerConditions,
    preconditions: candidate.preconditions,
    observationRequirements: candidate.observationRequirements ?? [],
    recommendedActionOrder: candidate.recommendedActionOrder,
    expectedEffects: candidate.expectedEffects,
    failureSemantics: candidate.failureSemantics ?? [],
    applicableScopes: candidate.applicableScopes,
    confidence: candidate.confidence,
    evaluationStatus: candidate.evaluationStatus,
  });
}

async function persistCandidate(
  tx: StrategyExtractionTransaction,
  input: {
    projectId: string;
    sourceRevision: string;
    strategyKey: string;
    candidate: StrategyCandidate;
  },
): Promise<StrategyExtractionResult> {
  const now = new Date();
  const candidateHash = canonicalJsonHash(input.candidate as unknown as JsonValue);
  const id = input.candidate.candidateId;
  const [inserted] = await tx
    .insert(aiStrategyCandidatesTable)
    .values({
      id,
      projectId: input.projectId,
      strategyKey: input.strategyKey,
      version: 1,
      candidate: input.candidate,
      candidateHash,
      confidence: String(input.candidate.confidence),
      supportingEpisodeIds: input.candidate.supportingEpisodeIds,
      contradictingEpisodeIds: input.candidate.contradictingEpisodeIds,
      evaluationStatus: "discovered",
      sourceRevision: input.sourceRevision,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: aiStrategyCandidatesTable.id });

  const [stored] = await tx
    .select()
    .from(aiStrategyCandidatesTable)
    .where(and(
      eq(aiStrategyCandidatesTable.projectId, input.projectId),
      eq(aiStrategyCandidatesTable.strategyKey, input.strategyKey),
      eq(aiStrategyCandidatesTable.version, 1),
    ))
    .for("update");
  if (!stored) throw new Error("strategy_candidate_insert_lost");

  const current = StrategyCandidateSchema.parse(stored.candidate);
  const currentHash = canonicalJsonHash(current as unknown as JsonValue);
  if (
    stored.id !== id
    || stored.sourceRevision !== input.sourceRevision
    || stored.candidateHash !== currentHash
    || stored.evaluationStatus !== current.evaluationStatus
    || stored.confidence !== String(current.confidence)
    || !sameStringSet(
      Array.isArray(stored.supportingEpisodeIds)
        ? stored.supportingEpisodeIds.filter((value): value is string => typeof value === "string")
        : [],
      current.supportingEpisodeIds,
    )
    || !sameStringSet(
      Array.isArray(stored.contradictingEpisodeIds)
        ? stored.contradictingEpisodeIds.filter((value): value is string => typeof value === "string")
        : [],
      current.contradictingEpisodeIds,
    )
    || candidateStaticHash(current) !== candidateStaticHash(input.candidate)
  ) {
    throw new Error("strategy_candidate_identity_conflict");
  }

  const supportIds = [...new Set([
    ...current.supportingEpisodeIds,
    ...input.candidate.supportingEpisodeIds,
  ])].sort();
  if (supportIds.length === current.supportingEpisodeIds.length) {
    return {
      status: "stored",
      candidate: current,
      candidateHash: currentHash,
      created: Boolean(inserted),
    };
  }
  if (stored.evaluationStatus !== "discovered") {
    return { status: "not_eligible", reason: "candidate_evaluation_started" };
  }

  const nextCandidate = StrategyCandidateSchema.parse({
    ...current,
    supportingEpisodeIds: supportIds,
  });
  const nextHash = canonicalJsonHash(nextCandidate as unknown as JsonValue);
  await tx
    .update(aiStrategyCandidatesTable)
    .set({
      candidate: nextCandidate,
      candidateHash: nextHash,
      supportingEpisodeIds: supportIds,
      updatedAt: now,
    })
    .where(eq(aiStrategyCandidatesTable.id, stored.id));
  return {
    status: "stored",
    candidate: nextCandidate,
    candidateHash: nextHash,
    created: Boolean(inserted),
  };
}

export async function extractAcceptedEpisodeStrategy(input: {
  projectId: string;
  episodeId: string;
}): Promise<StrategyExtractionResult> {
  return db.transaction(async (tx) => {
    const [episode] = await tx
      .select()
      .from(aiAgentEpisodesTable)
      .where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
      ))
      .for("update");
    if (!episode) return { status: "not_eligible", reason: "episode_not_found" };
    if (
      episode.state !== "completed"
      || episode.verdict !== "achieved"
      || !episode.closedAt
    ) {
      return { status: "not_eligible", reason: "episode_not_accepted" };
    }

    const [execution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, episode.executionId),
        eq(aiExecutionsTable.projectId, episode.projectId),
      ))
      .for("update");
    if (
      !execution
      || execution.status !== "completed"
      || execution.attempt !== episode.attempt
      || execution.baseRevision !== episode.projectRevision
      || !execution.operationId
    ) {
      return { status: "not_eligible", reason: "execution_identity_mismatch" };
    }

    const [acceptance] = await tx
      .select()
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, execution.id),
        eq(aiExecutionAcceptancesTable.projectId, input.projectId),
        eq(aiExecutionAcceptancesTable.attempt, episode.attempt),
      ))
      .limit(1);
    if (
      !acceptance
      || acceptance.outcome !== "SUCCEEDED"
      || acceptance.terminalStatus !== "completed"
      || acceptance.sourceRevision !== episode.projectRevision
      || !acceptance.effectBundleId
    ) {
      return { status: "not_eligible", reason: "episode_not_accepted" };
    }

    const eventRows = await tx
      .select()
      .from(aiAgentEpisodeEventsTable)
      .where(eq(aiAgentEpisodeEventsTable.episodeId, episode.id))
      .orderBy(asc(aiAgentEpisodeEventsTable.sequence));
    for (const [index, row] of eventRows.entries()) {
      let payloadHash: string;
      try {
        payloadHash = persistedEventPayloadHash(row);
      } catch {
        return { status: "not_eligible", reason: "event_stream_invalid" };
      }
      if (
        row.projectId !== episode.projectId
        || row.executionId !== episode.executionId
        || row.attempt !== episode.attempt
        || row.sequence !== index
      ) {
        return { status: "not_eligible", reason: "event_identity_mismatch" };
      }
      if (
        row.eventType !== "EPISODE_CREATED"
        && row.actorType === "worker"
        && row.actorId !== episode.workerId
      ) {
        return { status: "not_eligible", reason: "event_actor_mismatch" };
      }
      if (row.payloadHash !== payloadHash) {
        return { status: "not_eligible", reason: "event_payload_hash_mismatch" };
      }
    }
    const terminalEvent = eventRows.find((event) => event.eventType === "EPISODE_TERMINAL");
    const terminalPayload = terminalEvent ? asRecord(terminalEvent.payload) : undefined;
    if (
      !terminalEvent
      || terminalEvent.actorType !== "server"
      || terminalEvent.actorId !== "acceptance-finalizer"
      || terminalEvent.correlationId !== execution.id
      || terminalPayload?.verdict !== "achieved"
      || terminalPayload.acceptanceId !== acceptance.id
      || terminalPayload.effectBundleId !== acceptance.effectBundleId
      || terminalPayload.reasonCode !== "CANONICAL_PROOF_PROVEN"
    ) {
      return { status: "not_eligible", reason: "terminal_event_invalid" };
    }

    const requests = eventRows.filter((event) => event.eventType === "ACTION_REQUESTED");
    const commits = eventRows.filter((event) => event.eventType === "ACTION_COMMITTED");
    if (requests.length !== 1 || commits.length !== 1) {
      return { status: "not_eligible", reason: "unsupported_action_trace" };
    }
    const action = actionRequest(requests[0]!.payload);
    const episodeScope = asRecord(episode.scope);
    const actionTrigger = action?.triggerConditions.length === 1
      ? asRecord(action.triggerConditions[0])
      : undefined;
    if (
      !action
      || requests[0]!.correlationId !== execution.id
      || requests[0]!.actorType !== "worker"
      || requests[0]!.actorId !== episode.workerId
      || commits[0]!.correlationId !== execution.id
      || commits[0]!.actorType !== "worker"
      || commits[0]!.actorId !== episode.workerId
      || !actionCommitMatches(commits[0]!.payload, action)
      || actionTrigger?.kind !== "server_recipe"
      || actionTrigger.recipeId !== episodeScope?.recipeId
    ) {
      return { status: "not_eligible", reason: "unsupported_action_trace" };
    }

    const [bundle] = await tx
      .select()
      .from(aiAgentEffectBundlesTable)
      .where(and(
        eq(aiAgentEffectBundlesTable.id, acceptance.effectBundleId),
        eq(aiAgentEffectBundlesTable.projectId, input.projectId),
        eq(aiAgentEffectBundlesTable.executionId, execution.id),
        eq(aiAgentEffectBundlesTable.attempt, episode.attempt),
        eq(aiAgentEffectBundlesTable.episodeId, episode.id),
      ))
      .for("update");
    if (!bundle) return { status: "not_eligible", reason: "missing_effect_bundle" };

    const effectIds = Array.isArray(bundle.effectIds)
      ? bundle.effectIds.filter((value): value is string => typeof value === "string")
      : [];
    const contractHashes = Array.isArray(bundle.effectContractHashes)
      ? bundle.effectContractHashes.filter((value): value is string => typeof value === "string")
      : [];
    if (
      bundle.verdict !== "OBSERVED"
      || effectIds.length === 0
      || new Set(effectIds).size !== effectIds.length
      || contractHashes.length !== effectIds.length
    ) {
      return { status: "not_eligible", reason: "effect_bundle_mismatch" };
    }

    const effectRows = await tx
      .select()
      .from(aiAgentEffectsTable)
      .where(and(
        eq(aiAgentEffectsTable.projectId, input.projectId),
        eq(aiAgentEffectsTable.executionId, execution.id),
        eq(aiAgentEffectsTable.episodeId, episode.id),
        eq(aiAgentEffectsTable.attempt, episode.attempt),
        inArray(aiAgentEffectsTable.id, effectIds),
      ));
    if (effectRows.length !== effectIds.length) {
      return { status: "not_eligible", reason: "effect_bundle_mismatch" };
    }

    const effects = effectRows.map((row) => AgentEffectSchema.safeParse({
      schemaVersion: "1",
      effectId: row.id,
      projectId: row.projectId,
      episodeId: row.episodeId,
      executionId: row.executionId,
      attempt: row.attempt,
      actionId: row.actionId,
      capabilityId: row.capabilityId,
      effectContractHash: row.effectContractHash,
      beforeObservationIds: row.beforeObservationIds,
      afterObservationIds: row.afterObservationIds,
      expectedEffects: row.expectedEffects,
      status: row.status,
      missingEffects: row.missingEffects,
      contradictionRefs: row.contradictionRefs,
      evidenceRefs: row.evidenceRefs,
      createdAt: row.createdAt.toISOString(),
    }));
    if (
      effects.some((parsed) => !parsed.success)
      || effectRows.some((row) =>
        row.actionId !== action.actionId
        || row.capabilityId !== action.capabilityId
        || row.status !== "observed"
        || !contractHashes.includes(row.effectContractHash))
      || !sameStringSet(
        effects.map((parsed) => parsed.success ? parsed.data.effectId : ""),
        effectIds,
      )
    ) {
      return { status: "not_eligible", reason: "effect_bundle_mismatch" };
    }

    const classifiedEvents = eventRows.filter((event) =>
      event.eventType === "EFFECT_CLASSIFIED"
      && asRecord(event.payload)?.actionId === action.actionId);
    const classifiedEffectIds = classifiedEvents.map((event) => {
      const payload = asRecord(event.payload);
      return payload?.effectId;
    });
    if (
      classifiedEvents.length !== effectIds.length
      || classifiedEvents.some((event) => {
        const payload = asRecord(event.payload);
        return event.correlationId !== execution.id
          || event.actorType !== "worker"
          || event.actorId !== episode.workerId
          || payload?.effectBundleId !== bundle.id
          || payload?.status !== "observed";
      })
      || !sameStringSet(
        classifiedEffectIds.filter((value): value is string => typeof value === "string"),
        effectIds,
      )
    ) {
      return { status: "not_eligible", reason: "effect_bundle_mismatch" };
    }

    const parsedEffects = effects.flatMap((parsed) => parsed.success ? [parsed.data] : []);
    const effectSignatures = parsedEffects.map((effect) => {
      const signature = normalizedEffectSignature(effect);
      return signature?.map((change) => ({
        capabilityId: effect.capabilityId,
        subject: change.subject,
        predicate: change.predicate,
      }));
    });
    if (effectSignatures.some((signature) => !signature)) {
      return { status: "not_eligible", reason: "effect_evidence_incomplete" };
    }
    const expectedEffectNames = [...new Set(parsedEffects.flatMap((effect) =>
      (normalizedEffectSignature(effect) ?? [])
        .map((change) => `${effect.capabilityId}:${change.predicate}`)))].sort();
    if (expectedEffectNames.length === 0) {
      return { status: "not_eligible", reason: "effect_evidence_incomplete" };
    }

    const observationIds = [...new Set(parsedEffects.flatMap((effect) => [
      ...effect.beforeObservationIds,
      ...effect.afterObservationIds,
    ]))];
    if (
      parsedEffects.some((effect) =>
        effect.beforeObservationIds.length === 0
        || effect.afterObservationIds.length === 0
        || effect.evidenceRefs.length === 0
        || effect.missingEffects.length > 0
        || effect.contradictionRefs.length > 0)
    ) {
      return { status: "not_eligible", reason: "effect_evidence_incomplete" };
    }
    const observationRows = await tx
      .select()
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, input.projectId),
        eq(aiAgentObservationsTable.executionId, execution.id),
        eq(aiAgentObservationsTable.episodeId, episode.id),
        inArray(aiAgentObservationsTable.id, observationIds),
      ));
    if (observationRows.length !== observationIds.length) {
      return { status: "not_eligible", reason: "effect_evidence_incomplete" };
    }
    const observations = observationRows.map((row) => ({
      row,
      parsed: rowToObservation(row),
    }));
    if (observations.some(({ row, parsed }) =>
      !parsed.success
      || parsed.data.projectId !== input.projectId
      || parsed.data.executionId !== execution.id
      || parsed.data.episodeId !== episode.id
      || parsed.data.provenance !== "DIRECT_OBSERVATION"
      || parsed.data.completeness !== "complete"
      || parsed.data.freshness !== "fresh"
      || parsed.data.projectRevision !== episode.projectRevision
      || parsed.data.evidenceRefs.length === 0
      || row.projectRevision !== episode.projectRevision)) {
      return { status: "not_eligible", reason: "effect_evidence_incomplete" };
    }

    const proof = await loadCanonicalProof({
      tx,
      executionId: execution.id,
      goalStatus: "completed",
      deliveryRequired: action.capabilityId.startsWith("github.push."),
      scope: {
        projectId: input.projectId,
        executionId: execution.id,
        operationId: execution.operationId,
        sourceRevision: episode.projectRevision,
        candidateIdentity: acceptance.candidateIdentity,
      },
      attempt: episode.attempt,
    });
    if (
      !proof.accepted
      || proof.verdict !== "PROVEN"
      || proof.acceptanceId !== acceptance.id
      || proof.operationId !== execution.operationId
      || proof.sourceRevision !== episode.projectRevision
    ) {
      return { status: "not_eligible", reason: "acceptance_not_proven" };
    }

    const signature = {
      projectId: input.projectId,
      sourceRevision: episode.projectRevision,
      intentKind: episode.intentKind,
      triggerConditions: action.triggerConditions,
      preconditions: action.preconditions,
      capabilityId: action.capabilityId,
      observationProfile: action.observationProfile,
      failureSemantics: action.failureSemantics,
      expectedEffects: expectedEffectNames,
      effectSubjects: effectSignatures,
    };
    const strategyKey = canonicalJsonHash(signature as unknown as JsonValue);
    const candidate = StrategyCandidateSchema.parse({
      schemaVersion: "1",
      candidateId: `strategy-candidate:${canonicalJsonHash({
        projectId: input.projectId,
        strategyKey,
        version: 1,
      } as unknown as JsonValue)}`,
      triggerConditions: action.triggerConditions,
      preconditions: action.preconditions,
      observationRequirements: [{
        kind: "direct_before_after",
        profile: action.observationProfile,
        completeness: "complete",
        freshness: "fresh",
      }],
      recommendedActionOrder: [action.capabilityId],
      expectedEffects: expectedEffectNames,
      failureSemantics: action.failureSemantics,
      supportingEpisodeIds: [episode.id],
      contradictingEpisodeIds: [],
      applicableScopes: [episode.intentKind],
      confidence: 0,
      evaluationStatus: "discovered",
    });
    return persistCandidate(tx, {
      projectId: input.projectId,
      sourceRevision: episode.projectRevision,
      strategyKey,
      candidate,
    });
  });
}