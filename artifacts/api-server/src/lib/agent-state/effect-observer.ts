import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import {
  AgentActionSchema,
  AGENT_STATE_SCHEMA_VERSION,
  AgentObservationSchema,
  canonicalJsonHash,
  classifyEffect,
  EffectContractSchema,
  hashEffectContract,
  type EffectStatus,
} from "@workspace/ai-orchestrator";
import type { JsonValue } from "@workspace/ai-orchestrator";
import { buildActionCreditAssignment } from "./action-credit-assignment.js";

type EffectObserverTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACTIVE_EXECUTION_STATUSES = new Set([
  "queued",
  "running",
  "paused",
  "cancelling",
]);

export type VerifyEffectInput = {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  workerId: string;
  action: unknown;
  effectContract: unknown;
  beforeObservationIds: readonly string[];
  afterObservationIds: readonly string[];
  acceptanceId?: string | null;
};

export type EffectVerificationResult = {
  effectBundleId: string;
  effectId: string;
  status: EffectStatus;
  missingEffects: string[];
  contradictionRefs: string[];
  evidenceRefs: string[];
  observedEffectCount: number;
  acceptanceLinked: boolean;
};

function appendUnique(current: unknown, additions: readonly string[]): string[] {
  const values = Array.isArray(current)
    ? current.filter((value): value is string => typeof value === "string")
    : [];
  return [...new Set([...values, ...additions])].slice(0, 128);
}

function verifyWorkerExecution(
  execution: typeof aiExecutionsTable.$inferSelect | undefined,
  input: VerifyEffectInput,
): asserts execution is typeof aiExecutionsTable.$inferSelect {
  if (!execution) throw new Error("effect_execution_not_found");
  if (execution.projectId !== input.projectId) throw new Error("effect_project_mismatch");
  if (execution.attempt !== input.attempt) throw new Error("effect_attempt_mismatch");
  if (execution.workerId !== input.workerId || !execution.leaseUntil || execution.leaseUntil <= new Date()) {
    throw new Error("effect_stale_worker");
  }
  if (!ACTIVE_EXECUTION_STATUSES.has(execution.status)) {
    throw new Error("effect_execution_not_writable");
  }
}

function rowToObservation(
  row: typeof import("@workspace/db").aiAgentObservationsTable.$inferSelect,
) {
  return AgentObservationSchema.parse({
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    observationId: row.id,
    projectId: row.projectId,
    executionId: row.executionId,
    episodeId: row.episodeId,
    // Direct effect observations are represented as external observations; the
    // provenance field, not a source label, controls acceptance eligibility.
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
    environmentFreshness: row.environmentFreshness,
    completeness: row.completeness,
    freshness: row.freshness,
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? row.evidenceRefs.filter((value): value is string => typeof value === "string")
      : [],
  });
}

async function lockExistingBundle(
  tx: EffectObserverTransaction,
  input: VerifyEffectInput,
  effectContractHash: string,
  actionId: string,
): Promise<{
  bundle: typeof aiAgentEffectBundlesTable.$inferSelect;
  effects: Array<typeof aiAgentEffectsTable.$inferSelect>;
  existingResult?: EffectVerificationResult;
} | undefined> {
  const [bundle] = await tx
    .select()
    .from(aiAgentEffectBundlesTable)
    .where(and(
      eq(aiAgentEffectBundlesTable.executionId, input.executionId),
      eq(aiAgentEffectBundlesTable.attempt, input.attempt),
    ))
    .for("update");
  if (!bundle) return undefined;
  if (
    bundle.projectId !== input.projectId
    || bundle.episodeId !== input.episodeId
    || !Array.isArray(bundle.effectContractHashes)
    || !bundle.effectContractHashes.includes(effectContractHash)
  ) {
    throw new Error("effect_bundle_identity_conflict");
  }
  const effectIds = Array.isArray(bundle.effectIds)
    ? bundle.effectIds.filter((value): value is string => typeof value === "string")
    : [];
  const effects = effectIds.length > 0
    ? await tx.select().from(aiAgentEffectsTable).where(inArray(aiAgentEffectsTable.id, effectIds))
    : [];
  if (effects.length !== effectIds.length) throw new Error("effect_bundle_effect_missing");
  const effect = effects.find((candidate) =>
    candidate.actionId === actionId && candidate.effectContractHash === effectContractHash);
  return {
    bundle,
    effects,
    ...(effect ? {
      existingResult: {
        effectBundleId: bundle.id,
        effectId: effect.id,
        status: effect.status,
        missingEffects: Array.isArray(effect.missingEffects)
          ? effect.missingEffects.filter((value): value is string => typeof value === "string")
          : [],
        contradictionRefs: Array.isArray(effect.contradictionRefs)
          ? effect.contradictionRefs.filter((value): value is string => typeof value === "string")
          : [],
        evidenceRefs: Array.isArray(effect.evidenceRefs)
          ? effect.evidenceRefs.filter((value): value is string => typeof value === "string")
          : [],
        observedEffectCount: effect.status === "observed" && Array.isArray(effect.expectedEffects)
          ? effect.expectedEffects.length
          : 0,
        acceptanceLinked: Boolean(input.acceptanceId),
      },
    } : {}),
  };
}

function aggregateEffectVerdict(statuses: readonly EffectStatus[]): string {
  if (statuses.length > 0 && statuses.every((status) => status === "observed")) return "OBSERVED";
  if (statuses.length > 0 && statuses.every((status) => status === "not_observed")) return "NOT_OBSERVED";
  if (statuses.length > 0 && statuses.every((status) => status === "contradicted")) return "CONTRADICTED";
  if (statuses.length > 0 && statuses.every((status) => status === "unknown")) return "UNKNOWN";
  return "PARTIAL";
}

/**
 * Persist one server-owned before/after effect classification. This is
 * deliberately separate from acceptance finalization: a classified effect
 * can be linked to an acceptance, but it cannot upgrade or impersonate it.
 */
export async function verifyAndPersistEffect(
  input: VerifyEffectInput,
): Promise<EffectVerificationResult> {
  if (input.beforeObservationIds.length === 0 || input.afterObservationIds.length === 0) {
    throw new Error("effect_requires_before_and_after_observations");
  }
  const action = AgentActionSchema.parse(input.action);
  const effectContract = EffectContractSchema.parse(input.effectContract);
  if (action.episodeId !== input.episodeId) throw new Error("effect_action_episode_mismatch");
  if (!action.expectedEffects.includes(effectContract.effectId)) {
    throw new Error("effect_action_contract_not_expected");
  }
  const effectContractHash = hashEffectContract(effectContract);

  return db.transaction(async (tx) => {
    const [execution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, input.executionId),
        eq(aiExecutionsTable.projectId, input.projectId),
      ))
      .for("update");
    verifyWorkerExecution(execution, input);

    const [episode] = await tx
      .select()
      .from(aiAgentEpisodesTable)
      .where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
      ))
      .for("update");
    if (!episode) throw new Error("effect_episode_not_found");
    if (episode.executionId !== input.executionId || episode.attempt !== input.attempt) {
      throw new Error("effect_episode_identity_mismatch");
    }
    if (episode.workerId !== input.workerId) throw new Error("effect_episode_worker_mismatch");

    const existing = await lockExistingBundle(tx, input, effectContractHash, action.actionId);
    if (existing?.existingResult) {
      if (input.acceptanceId) {
        await linkAcceptance(tx, input, existing.existingResult.effectBundleId, existing.existingResult.status);
        existing.existingResult.acceptanceLinked = true;
      }
      return existing.existingResult;
    }

    const observationIds = [...new Set([
      ...input.beforeObservationIds,
      ...input.afterObservationIds,
    ])];
    const observations = await tx
      .select()
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, input.projectId),
        eq(aiAgentObservationsTable.executionId, input.executionId),
        eq(aiAgentObservationsTable.episodeId, input.episodeId),
        inArray(aiAgentObservationsTable.id, observationIds),
      ));
    if (observations.length !== observationIds.length) {
      throw new Error("effect_observation_identity_missing");
    }
    const observationById = new Map(observations.map((row) => [row.id, rowToObservation(row)]));
    const before = input.beforeObservationIds.map((id) => observationById.get(id)).filter(
      (observation): observation is NonNullable<typeof observation> => Boolean(observation),
    );
    const after = input.afterObservationIds.map((id) => observationById.get(id)).filter(
      (observation): observation is NonNullable<typeof observation> => Boolean(observation),
    );
    const classification = classifyEffect({ contract: effectContract, before, after });
    const effectId = randomUUID();
    const effectBundleId = existing?.bundle.id ?? randomUUID();
    const creditAssignment = buildActionCreditAssignment({
      actionId: action.actionId,
      effectId,
      effectBundleId,
      effectStatus: classification.status,
      observedEffectCount: classification.observedEffectCount,
      expectedEffectCount: effectContract.expectedStateChanges.length,
      beforeObservationIds: input.beforeObservationIds,
      afterObservationIds: input.afterObservationIds,
    });
    const now = new Date();

    await tx.insert(aiAgentEffectsTable).values({
      id: effectId,
      projectId: input.projectId,
      executionId: input.executionId,
      episodeId: input.episodeId,
      attempt: input.attempt,
      actionId: action.actionId,
      capabilityId: action.capabilityId,
      effectContractHash,
      beforeObservationIds: [...new Set(input.beforeObservationIds)],
      afterObservationIds: [...new Set(input.afterObservationIds)],
      expectedEffects: effectContract.expectedStateChanges,
      status: classification.status,
      missingEffects: classification.missingEffects,
      contradictionRefs: classification.contradictionRefs,
      evidenceRefs: classification.evidenceRefs,
      createdAt: now,
    });
    if (existing) {
      const effectIds = [
        ...(Array.isArray(existing.bundle.effectIds)
          ? existing.bundle.effectIds.filter((value): value is string => typeof value === "string")
          : []),
        effectId,
      ];
      const effectContractHashes = [
        ...(Array.isArray(existing.bundle.effectContractHashes)
          ? existing.bundle.effectContractHashes.filter((value): value is string => typeof value === "string")
          : []),
        effectContractHash,
      ];
      await tx.update(aiAgentEffectBundlesTable).set({
        effectIds,
        effectContractHashes,
        verdict: aggregateEffectVerdict([
          ...existing.effects.map((effect) => effect.status),
          classification.status,
        ]),
      }).where(eq(aiAgentEffectBundlesTable.id, effectBundleId));
    } else {
      await tx.insert(aiAgentEffectBundlesTable).values({
        id: effectBundleId,
        projectId: input.projectId,
        executionId: input.executionId,
        attempt: input.attempt,
        episodeId: input.episodeId,
        effectIds: [effectId],
        effectContractHashes: [effectContractHash],
        verdict: classification.status.toUpperCase(),
        worldRevision: episode.worldRevision,
        createdAt: now,
      });
    }

    if (input.acceptanceId) await linkAcceptance(tx, input, effectBundleId, classification.status);

    const nextState = classification.status === "observed" ? "verifying" : "needs_replan";
    await tx.update(aiAgentEpisodesTable).set({
      state: nextState,
      actionRefs: appendUnique(episode.actionRefs, [action.actionId]),
      expectedEffectRefs: appendUnique(episode.expectedEffectRefs, [effectContract.effectId]),
      observedEffectRefs: appendUnique(episode.observedEffectRefs, [effectId]),
      evidenceRefs: appendUnique(episode.evidenceRefs, classification.evidenceRefs),
      updatedAt: now,
    }).where(eq(aiAgentEpisodesTable.id, episode.id));

    const [lastEvent] = await tx
      .select({ sequence: aiAgentEpisodeEventsTable.sequence })
      .from(aiAgentEpisodeEventsTable)
      .where(eq(aiAgentEpisodeEventsTable.episodeId, episode.id))
      .orderBy(desc(aiAgentEpisodeEventsTable.sequence))
      .limit(1);
    const sequence = (lastEvent?.sequence ?? -1) + 1;
    await tx.insert(aiAgentEpisodeEventsTable).values({
      id: randomUUID(),
      episodeId: episode.id,
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      sequence,
      eventType: "EFFECT_CLASSIFIED",
      payload: {
        effectId,
        effectBundleId,
        actionId: action.actionId,
        status: classification.status,
        beforeObservationIds: [...new Set(input.beforeObservationIds)],
        afterObservationIds: [...new Set(input.afterObservationIds)],
        creditAssignment,
      },
      payloadHash: canonicalJsonHash({
        effectId,
        effectBundleId,
        actionId: action.actionId,
        status: classification.status,
        creditAssignment,
      }),
      actorType: "worker",
      actorId: input.workerId,
      correlationId: input.executionId,
      createdAt: now,
    });
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiAgentEpisodeEvent",
      projectId: input.projectId,
      ...(episode.goalId ? { goalId: episode.goalId } : {}),
      payload: {
        episodeId: episode.id,
        executionId: input.executionId,
        attempt: input.attempt,
        sequence,
        eventType: "EFFECT_CLASSIFIED",
        effectId,
        effectBundleId,
        status: classification.status,
      },
      severity: classification.status === "observed" ? "info" : "warning",
      message: "AI agent effect classification recorded.",
      correlationId: input.executionId,
      timestamp: now,
    });

    return {
      effectBundleId,
      effectId,
      status: classification.status,
      missingEffects: classification.missingEffects,
      contradictionRefs: classification.contradictionRefs,
      evidenceRefs: classification.evidenceRefs,
      observedEffectCount: classification.observedEffectCount,
      acceptanceLinked: Boolean(input.acceptanceId),
    };
  });
}

async function linkAcceptance(
  tx: EffectObserverTransaction,
  input: VerifyEffectInput,
  effectBundleId: string,
  effectStatus: EffectStatus,
): Promise<void> {
  const [acceptance] = await tx
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.id, input.acceptanceId!),
      eq(aiExecutionAcceptancesTable.executionId, input.executionId),
    ))
    .for("update");
  if (!acceptance) throw new Error("effect_acceptance_not_found");
  if (
    acceptance.projectId !== input.projectId
    || acceptance.attempt !== input.attempt
  ) {
    throw new Error("effect_acceptance_identity_mismatch");
  }
  if (acceptance.effectBundleId && acceptance.effectBundleId !== effectBundleId) {
    throw new Error("effect_acceptance_bundle_conflict");
  }
  if (acceptance.outcome === "SUCCEEDED" && effectStatus !== "observed") {
    throw new Error("effect_cannot_link_non_observed_to_succeeded_acceptance");
  }
  if (!acceptance.effectBundleId) {
    await tx.update(aiExecutionAcceptancesTable)
      .set({ effectBundleId })
      .where(eq(aiExecutionAcceptancesTable.id, acceptance.id));
  }
}