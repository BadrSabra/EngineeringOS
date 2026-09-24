import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  db,
} from "@workspace/db";
import {
  canonicalJsonHash,
  parseBoundedJson,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import { logger } from "../logger.js";
import { materializeWorldStateForProject } from "./world-state.js";

const MAX_SOURCES = 32;
const MAX_SOURCE_REFS = 8;
const MAX_VALUE_BYTES = 8 * 1024;
const MAX_TEXT = 240;

type ObservationCompleteness = "complete" | "partial" | "failed";
type ObservationFreshness = "fresh" | "stale" | "unknown";

export type ServerOwnedObservationSource =
  | {
      kind: "acceptance";
      sourceId: string;
      sourceRevision?: string | null;
      terminalStatus: string;
      outcome: string;
      reasonCode: string;
      nextActionCode?: string | null;
      evidenceComplete: boolean;
      evidenceRefs?: readonly string[];
      observedAt?: Date | string;
    }
  | {
      kind: "validator_receipt";
      validatorId: string;
      operationId: string;
      projectId: string;
      workspaceRevision: string;
      status: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
      artifactRef: string;
      observedAt?: Date | string;
    }
  | {
      kind: "runtime_receipt";
      sourceId: string;
      sourceRevision?: string | null;
      status: "started" | "passed" | "failed" | "blocked" | "cancelled" | "unknown";
      profile?: string | null;
      candidateIdentity?: string | null;
      observedAt?: Date | string;
    }
  | {
      kind: "delivery_receipt";
      sourceId: string;
      sourceRevision?: string | null;
      status: "started" | "passed" | "failed" | "blocked" | "cancelled" | "unknown";
      candidateIdentity?: string | null;
      treeHash?: string | null;
      observedAt?: Date | string;
    };

export type MaterializeServerOwnedObservationsInput = {
  projectId: string;
  executionId: string;
  attempt: number;
  projectRevision?: string | null;
  episodeId?: string;
  sources: readonly ServerOwnedObservationSource[];
};

export type ObservationMaterializationResult = {
  episodeId: string;
  inserted: number;
  duplicates: number;
  stale: number;
};

function boundedText(value: string, max = MAX_TEXT): string {
  return value.trim().slice(0, max);
}

function boundedRefs(refs: readonly string[] | undefined): string[] {
  return [...new Set((refs ?? [])
    .filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
    .map((ref) => boundedText(ref, 500)))]
    .slice(0, MAX_SOURCE_REFS);
}

function observedAt(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    throw new Error("observation_source_invalid_timestamp");
  }
  return date;
}

function sourceVersion(sourceRevision: string | null | undefined, attempt: number): string {
  return boundedText(sourceRevision ?? `attempt:${attempt}`, 2_000);
}

function freshness(
  sourceRevision: string | null | undefined,
  projectRevision: string | null | undefined,
): ObservationFreshness {
  if (!sourceRevision || !projectRevision) return "unknown";
  return sourceRevision === projectRevision ? "fresh" : "stale";
}

function statusCompleteness(status: string): ObservationCompleteness {
  if (["passed", "PROVEN"].includes(status)) return "complete";
  if (["failed", "cancelled", "UNAVAILABLE"].includes(status)) return "failed";
  return "partial";
}

type NormalizedObservation = {
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  subject: string;
  predicate: string;
  value: JsonValue;
  sourceRefs: string[];
  observedAt: Date;
  completeness: ObservationCompleteness;
};

function normalizeSource(
  source: ServerOwnedObservationSource,
  attempt: number,
): NormalizedObservation {
  if (source.kind === "acceptance") {
    const value = parseBoundedJson(JSON.stringify({
      terminalStatus: boundedText(source.terminalStatus),
      outcome: boundedText(source.outcome),
      reasonCode: boundedText(source.reasonCode),
      ...(source.nextActionCode ? { nextActionCode: boundedText(source.nextActionCode) } : {}),
      evidenceComplete: source.evidenceComplete,
    }), MAX_VALUE_BYTES);
    return {
      sourceType: "acceptance",
      sourceId: boundedText(source.sourceId, 500),
      sourceVersion: sourceVersion(source.sourceRevision, attempt),
      subject: `execution:${boundedText(source.sourceId, 500)}`,
      predicate: "acceptance.outcome",
      value,
      sourceRefs: boundedRefs(source.evidenceRefs),
      observedAt: observedAt(source.observedAt),
      completeness: source.evidenceComplete ? "complete" : "partial",
    };
  }

  if (source.kind === "validator_receipt") {
    const value = parseBoundedJson(JSON.stringify({
      validatorId: boundedText(source.validatorId),
      status: source.status,
      artifactRef: boundedText(source.artifactRef, 500),
    }), MAX_VALUE_BYTES);
    return {
      sourceType: "validator_receipt",
      sourceId: boundedText(`${source.validatorId}:${source.operationId}`, 500),
      sourceVersion: sourceVersion(source.workspaceRevision, attempt),
      subject: `execution:${boundedText(source.operationId, 500)}`,
      predicate: `validator.${boundedText(source.validatorId)}`,
      value,
      sourceRefs: boundedRefs([source.artifactRef]),
      observedAt: observedAt(source.observedAt),
      completeness: statusCompleteness(source.status),
    };
  }

  if (source.kind === "runtime_receipt") {
    const value = parseBoundedJson(JSON.stringify({
      status: source.status,
      ...(source.profile ? { profile: boundedText(source.profile) } : {}),
      ...(source.candidateIdentity ? { candidateIdentity: boundedText(source.candidateIdentity, 500) } : {}),
    }), MAX_VALUE_BYTES);
    return {
      sourceType: "runtime_receipt",
      sourceId: boundedText(source.sourceId, 500),
      sourceVersion: sourceVersion(source.sourceRevision, attempt),
      subject: `execution:${boundedText(source.sourceId, 500)}`,
      predicate: "runtime.status",
      value,
      sourceRefs: [],
      observedAt: observedAt(source.observedAt),
      completeness: statusCompleteness(source.status),
    };
  }

  const value = parseBoundedJson(JSON.stringify({
    status: source.status,
    ...(source.candidateIdentity ? { candidateIdentity: boundedText(source.candidateIdentity, 500) } : {}),
    ...(source.treeHash ? { treeHash: boundedText(source.treeHash, 500) } : {}),
  }), MAX_VALUE_BYTES);
  return {
    sourceType: "delivery_receipt",
    sourceId: boundedText(source.sourceId, 500),
    sourceVersion: sourceVersion(source.sourceRevision, attempt),
    subject: `execution:${boundedText(source.sourceId, 500)}`,
    predicate: "delivery.status",
    value,
    sourceRefs: boundedRefs([source.treeHash ?? ""]),
    observedAt: observedAt(source.observedAt),
    completeness: statusCompleteness(source.status),
  };
}

/**
 * Materializes only bounded, server-owned receipt fields. Provider prose is
 * deliberately not part of this input contract.
 */
export async function materializeServerOwnedObservations(
  input: MaterializeServerOwnedObservationsInput,
): Promise<ObservationMaterializationResult> {
  if (!input.projectId || !input.executionId || !Number.isInteger(input.attempt) || input.attempt < 0) {
    throw new Error("observation_materialization_invalid_identity");
  }
  if (input.sources.length === 0 || input.sources.length > MAX_SOURCES) {
    throw new Error("observation_materialization_invalid_source_count");
  }

  const normalized = input.sources.map((source) => normalizeSource(source, input.attempt));
  for (const source of input.sources) {
    if (source.kind === "validator_receipt" && source.projectId !== input.projectId) {
      throw new Error("observation_materialization_project_mismatch");
    }
  }
  const result = await db.transaction(async (tx) => {
    const episodeFilters = [
      eq(aiAgentEpisodesTable.projectId, input.projectId),
      eq(aiAgentEpisodesTable.executionId, input.executionId),
      eq(aiAgentEpisodesTable.attempt, input.attempt),
    ];
    if (input.episodeId) episodeFilters.push(eq(aiAgentEpisodesTable.id, input.episodeId));
    const [episode] = await tx
      .select()
      .from(aiAgentEpisodesTable)
      .where(and(...episodeFilters))
      .for("update");
    if (!episode) throw new Error("observation_materialization_episode_not_found");

    let nextSequence = 0;
    const [latest] = await tx
      .select({ sequence: aiAgentObservationsTable.sequence })
      .from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.episodeId, episode.id))
      .orderBy(desc(aiAgentObservationsTable.sequence))
      .limit(1);
    if (latest) nextSequence = latest.sequence + 1;

    let inserted = 0;
    let duplicates = 0;
    let stale = 0;
    const initialObservationRefs = Array.isArray(episode.observationRefs)
      ? episode.observationRefs.filter((ref): ref is string => typeof ref === "string").slice(0, 128)
      : [];
    const observationRefs = new Set<string>(initialObservationRefs);

    for (const source of normalized) {
      const valueHash = canonicalJsonHash(source.value);
      const [existing] = await tx
        .select()
        .from(aiAgentObservationsTable)
        .where(and(
          eq(aiAgentObservationsTable.projectId, input.projectId),
          eq(aiAgentObservationsTable.sourceType, source.sourceType),
          eq(aiAgentObservationsTable.sourceId, source.sourceId),
          eq(aiAgentObservationsTable.sourceVersion, source.sourceVersion),
          eq(aiAgentObservationsTable.predicate, source.predicate),
          eq(aiAgentObservationsTable.valueHash, valueHash),
        ))
        .limit(1);
      if (existing) {
        duplicates++;
        observationRefs.add(existing.id);
        continue;
      }

      const observationId = randomUUID();
      const currentFreshness = freshness(
        source.sourceVersion.startsWith("attempt:") ? null : source.sourceVersion,
        input.projectRevision ?? episode.projectRevision,
      );
      const observationProjectRevision = source.sourceVersion.startsWith("attempt:")
        ? input.projectRevision ?? episode.projectRevision
        : source.sourceVersion;
      await tx.insert(aiAgentObservationsTable).values({
        id: observationId,
        projectId: input.projectId,
        executionId: input.executionId,
        episodeId: episode.id,
        kind: source.sourceType,
        observationRole: source.predicate,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        subject: source.subject,
        predicate: source.predicate,
        value: source.value,
        valueHash,
        sourceRefs: source.sourceRefs,
        observedAt: source.observedAt,
        projectRevision: observationProjectRevision,
        completeness: source.completeness,
        freshness: currentFreshness,
        evidenceRefs: source.sourceRefs,
        sequence: nextSequence++,
      });
      observationRefs.add(observationId);
      inserted++;
      if (currentFreshness === "stale") stale++;
    }

    const boundedObservationRefs = [...observationRefs].slice(0, 128);
    if (inserted > 0 || boundedObservationRefs.length !== initialObservationRefs.length) {
      await tx.update(aiAgentEpisodesTable)
        .set({ observationRefs: boundedObservationRefs, updatedAt: new Date() })
        .where(eq(aiAgentEpisodesTable.id, episode.id));
    }
    return { episodeId: episode.id, inserted, duplicates, stale };
  });

  // World State is a derived read-only projection. Its failure must not
  // change the already-committed observation or acceptance outcome.
  try {
    await materializeWorldStateForProject(input.projectId);
  } catch (error) {
    logger.warn(
      {
        projectId: input.projectId,
        executionId: input.executionId,
        episodeId: result.episodeId,
        error,
      },
      "World State materialization failed after observations were committed",
    );
  }

  return result;
}