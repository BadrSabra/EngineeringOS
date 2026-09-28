import type { AiExecutionEvidenceBraid } from "@workspace/api-zod";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentObservationsTable,
  db,
} from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

const MAX_EPISODES = 12;
const MAX_EVENTS = 160;
const MAX_OBSERVATIONS = 120;
const MAX_EFFECTS = 80;
const MAX_EFFECT_BUNDLES = 32;

type ExecutionIdentity = {
  executionId: string;
  projectId: string;
  attempt: number;
};

function dateOrNull(value: Date | null): Date | null {
  return value ?? null;
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function matchedIds(value: unknown, allowedIds: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => (
    typeof id === "string" && allowedIds.has(id)
  ));
}

export async function loadEpisodeEvidenceBraid(
  identity: ExecutionIdentity,
): Promise<AiExecutionEvidenceBraid> {
  const episodeRows = await db
    .select({
      id: aiAgentEpisodesTable.id,
      projectId: aiAgentEpisodesTable.projectId,
      executionId: aiAgentEpisodesTable.executionId,
      attempt: aiAgentEpisodesTable.attempt,
      missionId: aiAgentEpisodesTable.missionId,
      goalId: aiAgentEpisodesTable.goalId,
      state: aiAgentEpisodesTable.state,
      verdict: aiAgentEpisodesTable.verdict,
      projectRevision: aiAgentEpisodesTable.projectRevision,
      environmentRevision: aiAgentEpisodesTable.environmentRevision,
      worldRevision: aiAgentEpisodesTable.worldRevision,
      planRevision: aiAgentEpisodesTable.planRevision,
      createdAt: aiAgentEpisodesTable.createdAt,
      closedAt: aiAgentEpisodesTable.closedAt,
    })
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.projectId, identity.projectId),
      eq(aiAgentEpisodesTable.executionId, identity.executionId),
      eq(aiAgentEpisodesTable.attempt, identity.attempt),
    ))
    .orderBy(desc(aiAgentEpisodesTable.createdAt), desc(aiAgentEpisodesTable.id))
    .limit(MAX_EPISODES + 1);

  const truncated = episodeRows.length > MAX_EPISODES;
  const episodes = episodeRows.slice(0, MAX_EPISODES).filter((episode) => (
    episode.projectId === identity.projectId
      && episode.executionId === identity.executionId
      && episode.attempt === identity.attempt
  ));
  const episodeIds = episodes.map((episode) => episode.id);
  const episodeIdSet = new Set(episodeIds);

  if (episodeIds.length === 0) {
    return {
      executionId: identity.executionId,
      projectId: identity.projectId,
      attempt: identity.attempt,
      truncated,
      episodes: [],
    };
  }

  const [eventRows, observationRows, effectRows, effectBundleRows] = await Promise.all([
    db
      .select({
        id: aiAgentEpisodeEventsTable.id,
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        projectId: aiAgentEpisodeEventsTable.projectId,
        executionId: aiAgentEpisodeEventsTable.executionId,
        attempt: aiAgentEpisodeEventsTable.attempt,
        sequence: aiAgentEpisodeEventsTable.sequence,
        eventType: aiAgentEpisodeEventsTable.eventType,
        createdAt: aiAgentEpisodeEventsTable.createdAt,
      })
      .from(aiAgentEpisodeEventsTable)
      .where(and(
        eq(aiAgentEpisodeEventsTable.projectId, identity.projectId),
        eq(aiAgentEpisodeEventsTable.executionId, identity.executionId),
        eq(aiAgentEpisodeEventsTable.attempt, identity.attempt),
        inArray(aiAgentEpisodeEventsTable.episodeId, episodeIds),
      ))
      .orderBy(asc(aiAgentEpisodeEventsTable.sequence), asc(aiAgentEpisodeEventsTable.createdAt))
      .limit(MAX_EVENTS + 1),
    db
      .select({
        id: aiAgentObservationsTable.id,
        episodeId: aiAgentObservationsTable.episodeId,
        projectId: aiAgentObservationsTable.projectId,
        executionId: aiAgentObservationsTable.executionId,
        observationRole: aiAgentObservationsTable.observationRole,
        kind: aiAgentObservationsTable.kind,
        provenance: aiAgentObservationsTable.provenance,
        completeness: aiAgentObservationsTable.completeness,
        freshness: aiAgentObservationsTable.freshness,
        environmentFreshness: aiAgentObservationsTable.environmentFreshness,
        projectRevision: aiAgentObservationsTable.projectRevision,
        environmentRevision: aiAgentObservationsTable.environmentRevision,
        observedAt: aiAgentObservationsTable.observedAt,
      })
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, identity.projectId),
        eq(aiAgentObservationsTable.executionId, identity.executionId),
        inArray(aiAgentObservationsTable.episodeId, episodeIds),
      ))
      .orderBy(desc(aiAgentObservationsTable.observedAt))
      .limit(MAX_OBSERVATIONS + 1),
    db
      .select({
        id: aiAgentEffectsTable.id,
        episodeId: aiAgentEffectsTable.episodeId,
        executionId: aiAgentEffectsTable.executionId,
        attempt: aiAgentEffectsTable.attempt,
        actionId: aiAgentEffectsTable.actionId,
        capabilityId: aiAgentEffectsTable.capabilityId,
        beforeObservationIds: aiAgentEffectsTable.beforeObservationIds,
        afterObservationIds: aiAgentEffectsTable.afterObservationIds,
        status: aiAgentEffectsTable.status,
        missingEffects: aiAgentEffectsTable.missingEffects,
        contradictionRefs: aiAgentEffectsTable.contradictionRefs,
      })
      .from(aiAgentEffectsTable)
      .where(and(
        eq(aiAgentEffectsTable.executionId, identity.executionId),
        eq(aiAgentEffectsTable.attempt, identity.attempt),
        inArray(aiAgentEffectsTable.episodeId, episodeIds),
      ))
      .orderBy(desc(aiAgentEffectsTable.createdAt))
      .limit(MAX_EFFECTS + 1),
    db
      .select({
        id: aiAgentEffectBundlesTable.id,
        episodeId: aiAgentEffectBundlesTable.episodeId,
        projectId: aiAgentEffectBundlesTable.projectId,
        executionId: aiAgentEffectBundlesTable.executionId,
        attempt: aiAgentEffectBundlesTable.attempt,
        effectIds: aiAgentEffectBundlesTable.effectIds,
        verdict: aiAgentEffectBundlesTable.verdict,
        worldRevision: aiAgentEffectBundlesTable.worldRevision,
        createdAt: aiAgentEffectBundlesTable.createdAt,
      })
      .from(aiAgentEffectBundlesTable)
      .where(and(
        eq(aiAgentEffectBundlesTable.projectId, identity.projectId),
        eq(aiAgentEffectBundlesTable.executionId, identity.executionId),
        eq(aiAgentEffectBundlesTable.attempt, identity.attempt),
        inArray(aiAgentEffectBundlesTable.episodeId, episodeIds),
      ))
      .orderBy(desc(aiAgentEffectBundlesTable.createdAt))
      .limit(MAX_EFFECT_BUNDLES + 1),
  ]);

  const boundedEvents = eventRows.slice(0, MAX_EVENTS).filter((event) => (
    event.projectId === identity.projectId
      && event.executionId === identity.executionId
      && event.attempt === identity.attempt
      && episodeIdSet.has(event.episodeId)
  ));
  const boundedObservations = observationRows.slice(0, MAX_OBSERVATIONS).filter((observation) => (
    observation.projectId === identity.projectId
      && observation.executionId === identity.executionId
      && episodeIdSet.has(observation.episodeId)
  ));
  const boundedEffects = effectRows.slice(0, MAX_EFFECTS).filter((effect) => (
    effect.executionId === identity.executionId
      && effect.attempt === identity.attempt
      && episodeIdSet.has(effect.episodeId)
  ));
  const boundedEffectBundles = effectBundleRows.slice(0, MAX_EFFECT_BUNDLES).filter((bundle) => (
    bundle.projectId === identity.projectId
      && bundle.executionId === identity.executionId
      && bundle.attempt === identity.attempt
      && episodeIdSet.has(bundle.episodeId)
  ));

  const projections = episodes.map((episode) => {
    const episodeObservationRows = boundedObservations.filter(
      (observation) => observation.episodeId === episode.id,
    );
    const episodeEffectRows = boundedEffects.filter((effect) => effect.episodeId === episode.id);
    const visibleObservationIds = new Set(episodeObservationRows.map((observation) => observation.id));
    const visibleEffectIds = new Set(episodeEffectRows.map((effect) => effect.id));
    const episodeEvents = boundedEvents
      .filter((event) => event.episodeId === episode.id)
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => ({
        id: event.id,
        sequence: event.sequence,
        eventType: event.eventType,
        createdAt: event.createdAt,
      }));
    const episodeObservations = episodeObservationRows.map((observation) => ({
        id: observation.id,
        observationRole: observation.observationRole,
        kind: observation.kind,
        provenance: observation.provenance,
        completeness: observation.completeness,
        freshness: observation.freshness,
        environmentFreshness: observation.environmentFreshness,
        projectRevision: observation.projectRevision,
        environmentRevision: observation.environmentRevision,
        observedAt: dateOrNull(observation.observedAt),
      }));
    const episodeEffects = episodeEffectRows.map((effect) => ({
        id: effect.id,
        actionId: effect.actionId,
        capabilityId: effect.capabilityId,
        status: effect.status,
        beforeObservationIds: matchedIds(effect.beforeObservationIds, visibleObservationIds),
        afterObservationIds: matchedIds(effect.afterObservationIds, visibleObservationIds),
        missingEffectCount: arrayCount(effect.missingEffects),
        contradictionCount: arrayCount(effect.contradictionRefs),
      }));
    const episodeEffectBundles = boundedEffectBundles
      .filter((bundle) => bundle.episodeId === episode.id)
      .map((bundle) => ({
        id: bundle.id,
        verdict: bundle.verdict,
        worldRevision: bundle.worldRevision,
        effectIds: matchedIds(bundle.effectIds, visibleEffectIds),
        createdAt: bundle.createdAt,
      }));

    return {
      id: episode.id,
      attempt: episode.attempt,
      missionId: episode.missionId,
      goalId: episode.goalId,
      state: episode.state,
      verdict: episode.verdict,
      projectRevision: episode.projectRevision,
      environmentRevision: episode.environmentRevision,
      worldRevision: episode.worldRevision,
      planRevision: episode.planRevision,
      createdAt: episode.createdAt,
      closedAt: dateOrNull(episode.closedAt),
      events: episodeEvents,
      observations: episodeObservations,
      effects: episodeEffects,
      effectBundles: episodeEffectBundles,
    };
  });

  return {
    executionId: identity.executionId,
    projectId: identity.projectId,
    attempt: identity.attempt,
    truncated: truncated
      || eventRows.length > MAX_EVENTS
      || observationRows.length > MAX_OBSERVATIONS
      || effectRows.length > MAX_EFFECTS
      || effectBundleRows.length > MAX_EFFECT_BUNDLES,
    episodes: projections,
  };
}