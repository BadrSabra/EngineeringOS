import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  db,
} from "@workspace/db";
import {
  canonicalJsonHash,
  invalidateContextSlice,
  parseBoundedJson,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import { logger } from "../logger.js";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./environment-attestation.js";
import {
  childProcessBindingDigest,
  type ChildProcessEnvironmentAttestation,
} from "./child-process-attestation.js";
import { materializeWorldStateForProject } from "./world-state.js";

const MAX_SOURCES = 32;
const MAX_SOURCE_REFS = 8;
const MAX_VALUE_BYTES = 8 * 1024;
const MAX_TEXT = 240;

type ObservationCompleteness = "complete" | "partial" | "failed";
type ObservationFreshness = "fresh" | "stale" | "unknown";

export type ServerOwnedObservationSource =
  | {
      kind: "direct_observation";
      sourceId: string;
      subject: string;
      predicate: string;
      value: JsonValue;
      sourceRevision?: string | null;
      environmentRevision?: string | null;
      evidenceRefs?: readonly string[];
      observedAt?: Date | string;
    }
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
      environmentRevision?: string | null;
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
      environmentRevision?: string | null;
      observedAt?: Date | string;
    }
  | {
      kind: "runtime_receipt";
      sourceId: string;
      sourceRevision?: string | null;
      status: "started" | "passed" | "failed" | "blocked" | "cancelled" | "unknown";
      profile?: string | null;
      candidateIdentity?: string | null;
      sessionId?: string | null;
      environmentRevision?: string | null;
      observedAt?: Date | string;
    }
  | {
      kind: "child_process_attestation";
      projectId: string;
      executionId: string;
      attempt: number;
      episodeId: string;
      operationId: string;
      sessionId: string;
      revision: string;
      status: ChildProcessEnvironmentAttestation["status"];
      reasonCode: ChildProcessEnvironmentAttestation["reasonCode"];
      bindingDigest: string;
      attestationDigest?: string | null;
      processEnvironmentDigest?: string | null;
      environmentRevision?: string | null;
      observedAt?: Date | string;
    }
  | {
      kind: "validator_process_attestation";
      projectId: string;
      executionId: string;
      attempt: number;
      episodeId: string;
      operationId: string;
      sessionId: string;
      validatorProfile: string;
      revision: string;
      status: ChildProcessEnvironmentAttestation["status"];
      reasonCode: ChildProcessEnvironmentAttestation["reasonCode"];
      bindingDigest: string;
      attestationDigest?: string | null;
      processEnvironmentDigest?: string | null;
      environmentRevision?: string | null;
      observedAt?: Date | string;
    }
  | {
      kind: "delivery_receipt";
      sourceId: string;
      sourceRevision?: string | null;
      status: "started" | "passed" | "failed" | "blocked" | "cancelled" | "unknown";
      candidateIdentity?: string | null;
      treeHash?: string | null;
      environmentRevision?: string | null;
      observedAt?: Date | string;
    };

export type MaterializeServerOwnedObservationsInput = {
  projectId: string;
  executionId: string;
  attempt: number;
  projectRevision?: string | null;
  episodeId?: string;
  /** Server-resolved root used for a receipt-time environment observation. */
  environmentRootPath?: string;
  /** Effect verification can defer the read-only world projection to P6. */
  materializeWorldState?: boolean;
  sources: readonly ServerOwnedObservationSource[];
};

export type ObservationMaterializationResult = {
  episodeId: string;
  observationIds: string[];
  inserted: number;
  duplicates: number;
  stale: number;
  environmentStale: number;
};

function environmentFreshnessFor(input: {
  episodeRevision?: string;
  receiptRevision?: string;
  observedRevision?: string;
  captureAttempted: boolean;
}): ObservationFreshness {
  const { episodeRevision, receiptRevision, observedRevision, captureAttempted } = input;
  if (receiptRevision && observedRevision && receiptRevision !== observedRevision) return "stale";
  if (episodeRevision && observedRevision && episodeRevision !== observedRevision) return "stale";
  if (
    episodeRevision
    && receiptRevision
    && episodeRevision !== receiptRevision
  ) {
    return "stale";
  }
  if (receiptRevision && observedRevision) return "fresh";
  if (episodeRevision && observedRevision && episodeRevision === observedRevision) return "fresh";
  if (episodeRevision && receiptRevision && episodeRevision === receiptRevision) return "fresh";
  if (!captureAttempted && episodeRevision) return "fresh";
  return "unknown";
}

function boundedText(value: string, max = MAX_TEXT): string {
  return value.trim().slice(0, max);
}

function taskScopeIdentity(episode: {
  id: string;
  projectId: string;
  missionId: string | null;
  goalId: string | null;
  scope: unknown;
}): string {
  if (!episode.scope || typeof episode.scope !== "object" || Array.isArray(episode.scope)) {
    return `unscoped:${episode.id}`;
  }
  const scope = episode.scope as Record<string, unknown>;
  if (scope.kind === "project" && !episode.missionId && !episode.goalId) return "project";
  const identity = parseBoundedJson(JSON.stringify({
    projectId: episode.projectId,
    missionId: episode.missionId,
    goalId: episode.goalId,
    scope,
  }), MAX_VALUE_BYTES);
  return `scope:${canonicalJsonHash(identity)}`;
}

function environmentRevisionIdentity(revision: string | null | undefined): string {
  return revision ? `revision:${revision}` : "unknown";
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
  provenance: "DIRECT_OBSERVATION" | "SERVER_DERIVED";
  sourceId: string;
  sourceVersion: string;
  subject: string;
  predicate: string;
  value: JsonValue;
  sourceRefs: string[];
  observedAt: Date;
  environmentRevision?: string | null;
  environmentFreshness?: ObservationFreshness;
  completeness: ObservationCompleteness;
};

function normalizeSource(
  source: ServerOwnedObservationSource,
  attempt: number,
): NormalizedObservation {
  if (source.kind === "direct_observation") {
    return {
      sourceType: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      sourceId: boundedText(source.sourceId, 500),
      sourceVersion: sourceVersion(source.sourceRevision, attempt),
      subject: boundedText(source.subject),
      predicate: boundedText(source.predicate),
      value: parseBoundedJson(source.value, MAX_VALUE_BYTES),
      sourceRefs: boundedRefs(source.evidenceRefs),
      observedAt: observedAt(source.observedAt),
      ...(source.environmentRevision ? { environmentRevision: boundedText(source.environmentRevision, 2_000) } : {}),
      completeness: "complete",
    };
  }
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
      provenance: "SERVER_DERIVED",
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
      environmentRevision: source.environmentRevision ?? null,
    }), MAX_VALUE_BYTES);
    return {
      sourceType: "validator_receipt",
      provenance: "SERVER_DERIVED",
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
      ...(source.sessionId ? { sessionId: boundedText(source.sessionId, 500) } : {}),
    }), MAX_VALUE_BYTES);
    return {
      sourceType: "runtime_receipt",
      provenance: "SERVER_DERIVED",
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

  if (source.kind === "child_process_attestation") {
    const value = parseBoundedJson(JSON.stringify({
      status: source.status,
      reasonCode: source.reasonCode,
      bindingDigest: source.bindingDigest,
      attestationDigest: source.attestationDigest ?? null,
      processEnvironmentDigest: source.processEnvironmentDigest ?? null,
      operationId: boundedText(source.operationId, 500),
      sessionId: boundedText(source.sessionId, 500),
    }), MAX_VALUE_BYTES);
    return {
      sourceType: "child_process_attestation",
      provenance: "DIRECT_OBSERVATION",
      sourceId: boundedText(`runtime-child-process:${source.sessionId}`, 500),
      sourceVersion: sourceVersion(source.revision, attempt),
      subject: `runtime:${boundedText(source.sessionId, 500)}`,
      predicate: "runtime.child_process_environment",
      value,
      sourceRefs: boundedRefs([`runtime:${source.sessionId}`]),
      observedAt: observedAt(source.observedAt),
      ...(source.environmentRevision ? { environmentRevision: boundedText(source.environmentRevision, 2_000) } : {}),
      completeness: source.status === "known"
        ? "complete"
        : source.status === "mismatch"
          ? "failed"
          : "partial",
    };
  }
  if (source.kind === "validator_process_attestation") {
    const value = parseBoundedJson(JSON.stringify({
      status: source.status,
      reasonCode: source.reasonCode,
      bindingDigest: source.bindingDigest,
      attestationDigest: source.attestationDigest ?? null,
      processEnvironmentDigest: source.processEnvironmentDigest ?? null,
      operationId: boundedText(source.operationId, 500),
      validationEvidenceId: boundedText(source.sessionId, 500),
      validatorProfile: boundedText(source.validatorProfile, 200),
    }), MAX_VALUE_BYTES);
    return {
      sourceType: "validator_process_attestation",
      provenance: "DIRECT_OBSERVATION",
      sourceId: boundedText(`validator-child-process:${source.sessionId}`, 500),
      sourceVersion: sourceVersion(source.revision, attempt),
      subject: `validator:${boundedText(source.validatorProfile, 200)}:${boundedText(source.sessionId, 500)}`,
      predicate: "validator.child_process_environment",
      value,
      sourceRefs: boundedRefs([`validation:${source.sessionId}`]),
      observedAt: observedAt(source.observedAt),
      ...(source.environmentRevision
        ? { environmentRevision: boundedText(source.environmentRevision, 2_000) }
        : {}),
      completeness: source.status === "known"
        ? "complete"
        : source.status === "mismatch"
          ? "failed"
          : "partial",
    };
  }

  const value = parseBoundedJson(JSON.stringify({
    status: source.status,
    ...(source.candidateIdentity ? { candidateIdentity: boundedText(source.candidateIdentity, 500) } : {}),
    ...(source.treeHash ? { treeHash: boundedText(source.treeHash, 500) } : {}),
  }), MAX_VALUE_BYTES);
  return {
    sourceType: "delivery_receipt",
    provenance: "SERVER_DERIVED",
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

  const normalized = input.sources.map((source) => {
    const result = normalizeSource(source, input.attempt);
    if (source.environmentRevision === undefined) return result;
    return {
      ...result,
      environmentRevision: source.environmentRevision === null
        ? null
        : boundedText(source.environmentRevision, 2_000),
    };
  });
  for (const source of input.sources) {
    if (source.kind === "validator_receipt" && source.projectId !== input.projectId) {
      throw new Error("observation_materialization_project_mismatch");
    }
    if (source.kind === "child_process_attestation" && (
      source.projectId !== input.projectId
      || source.executionId !== input.executionId
      || source.attempt !== input.attempt
      || !source.sessionId
      || !source.operationId
      || !source.episodeId
      || !source.revision
      || source.bindingDigest !== childProcessBindingDigest({
        projectId: source.projectId,
        sessionId: source.sessionId,
        executionId: source.executionId,
        executionAttempt: source.attempt,
        episodeId: source.episodeId,
        operationId: source.operationId,
        revision: source.revision,
      })
      || (source.status === "known" && (
        !source.attestationDigest
        || !/^[a-f0-9]{64}$/.test(source.attestationDigest)
        || !source.processEnvironmentDigest
        || !/^[a-f0-9]{64}$/.test(source.processEnvironmentDigest)
      ))
      || (source.status === "mismatch" && source.reasonCode === "child_environment_mismatch" && (
        !source.attestationDigest
        || !/^[a-f0-9]{64}$/.test(source.attestationDigest)
        || !source.processEnvironmentDigest
        || !/^[a-f0-9]{64}$/.test(source.processEnvironmentDigest)
      ))
    )) {
      throw new Error("observation_materialization_child_attestation_mismatch");
    }
    if (source.kind === "validator_process_attestation") {
      const binding = {
        projectId: source.projectId,
        sessionId: source.sessionId,
        executionId: source.executionId,
        executionAttempt: source.attempt,
        episodeId: source.episodeId,
        operationId: source.operationId,
        revision: source.revision,
        processRole: "validator" as const,
        validatorProfile: source.validatorProfile,
      };
      const hasValidDigest = (value: string | null | undefined): value is string =>
        typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
      const isKnownEvidence = source.status === "known"
        && source.reasonCode === "child_process_observed"
        && hasValidDigest(source.attestationDigest)
        && hasValidDigest(source.processEnvironmentDigest);
      const isEnvironmentMismatch = source.status === "mismatch"
        && source.reasonCode === "child_environment_mismatch"
        && hasValidDigest(source.attestationDigest)
        && hasValidDigest(source.processEnvironmentDigest);
      const isRootMismatch = source.status === "mismatch"
        && source.reasonCode === "process_root_mismatch"
        && source.attestationDigest == null
        && source.processEnvironmentDigest == null;
      const isUnknown = source.status === "unknown"
        && source.attestationDigest == null
        && source.processEnvironmentDigest == null;
      if (
        source.projectId !== input.projectId
        || source.executionId !== input.executionId
        || source.attempt !== input.attempt
        || !Number.isInteger(source.attempt)
        || !source.sessionId
        || !source.operationId
        || !source.episodeId
        || !source.revision
        || !source.validatorProfile.trim()
        || !/^[a-f0-9]{64}$/.test(source.bindingDigest)
        || source.bindingDigest !== childProcessBindingDigest(binding)
        || !(isKnownEvidence || isEnvironmentMismatch || isRootMismatch || isUnknown)
      ) {
        throw new Error("observation_materialization_validator_attestation_mismatch");
      }
    }
  }
  let observedEnvironmentRevision: string | undefined;
  const environmentCaptureAttempted = Boolean(input.environmentRootPath);
  if (input.environmentRootPath) {
    const preflightFilters = [
      eq(aiAgentEpisodesTable.projectId, input.projectId),
      eq(aiAgentEpisodesTable.executionId, input.executionId),
      eq(aiAgentEpisodesTable.attempt, input.attempt),
    ];
    if (input.episodeId) preflightFilters.push(eq(aiAgentEpisodesTable.id, input.episodeId));
    const [profileEpisode] = await db
      .select({
        intentKind: aiAgentEpisodesTable.intentKind,
        scope: aiAgentEpisodesTable.scope,
      })
      .from(aiAgentEpisodesTable)
      .where(and(...preflightFilters))
      .limit(1);
    if (!profileEpisode) throw new Error("observation_materialization_episode_not_found");
    try {
      const attestation = await captureEnvironmentAttestation({
        rootPath: input.environmentRootPath,
        profile: serverEnvironmentProfile(profileEpisode.intentKind, profileEpisode.scope),
      });
      if (attestation.status === "known") {
        observedEnvironmentRevision = attestation.environmentRevision;
      }
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, executionId: input.executionId, error },
        "Receipt-time environment observation failed",
      );
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
    for (const source of input.sources) {
      if (
        source.kind !== "child_process_attestation"
        && source.kind !== "validator_process_attestation"
      ) continue;
      const scope = episode.scope !== null
        && typeof episode.scope === "object"
        && !Array.isArray(episode.scope)
        ? episode.scope as Record<string, unknown>
        : {};
      if (
        source.episodeId !== episode.id
        || (scope?.operationId !== undefined && source.operationId !== scope.operationId)
        || source.revision !== (input.projectRevision ?? episode.projectRevision)
      ) {
        throw new Error("observation_materialization_child_attestation_episode_mismatch");
      }
    }
    const taskScope = taskScopeIdentity(episode);
    const episodeEnvironmentRevision = episode.environmentRevision ?? undefined;
    const boundObservations = normalized.map((source) => {
      const environmentFreshness = source.environmentRevision === null
        ? "unknown"
        : environmentFreshnessFor({
            episodeRevision: episodeEnvironmentRevision,
            receiptRevision: source.environmentRevision,
            observedRevision: observedEnvironmentRevision,
            captureAttempted: environmentCaptureAttempted,
          });
      const environmentRevision = source.environmentRevision === null
        ? undefined
        : source.environmentRevision ?? observedEnvironmentRevision ?? episodeEnvironmentRevision;
      return {
        ...source,
        environmentFreshness,
        ...(environmentRevision ? { environmentRevision } : {}),
      };
    });

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
    let environmentStale = 0;
    const observationIds: string[] = [];
    const initialObservationRefs = Array.isArray(episode.observationRefs)
      ? episode.observationRefs.filter((ref): ref is string => typeof ref === "string").slice(0, 128)
      : [];
    const observationRefs = new Set<string>(initialObservationRefs);

    for (const source of boundObservations) {
      const valueHash = canonicalJsonHash(source.value);
      if (source.environmentFreshness === "stale") environmentStale++;
      const [existing] = await tx
        .select()
        .from(aiAgentObservationsTable)
        .where(and(
          eq(aiAgentObservationsTable.projectId, input.projectId),
          eq(aiAgentObservationsTable.taskScope, taskScope),
          source.environmentRevision
            ? eq(aiAgentObservationsTable.environmentRevision, source.environmentRevision)
            : isNull(aiAgentObservationsTable.environmentRevision),
          eq(aiAgentObservationsTable.environmentFreshness, source.environmentFreshness),
          eq(aiAgentObservationsTable.sourceType, source.sourceType),
          eq(aiAgentObservationsTable.sourceId, source.sourceId),
          eq(aiAgentObservationsTable.sourceVersion, source.sourceVersion),
          eq(aiAgentObservationsTable.predicate, source.predicate),
          eq(aiAgentObservationsTable.valueHash, valueHash),
        ))
        .limit(1);
      if (existing) {
        duplicates++;
        observationIds.push(existing.id);
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
        taskScope,
        environmentRevisionKey: environmentRevisionIdentity(source.environmentRevision),
        kind: source.sourceType,
        provenance: source.provenance,
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
        ...(source.environmentRevision ? { environmentRevision: source.environmentRevision } : {}),
        completeness: source.completeness,
        freshness: currentFreshness,
        environmentFreshness: source.environmentFreshness,
        evidenceRefs: source.sourceRefs,
        sequence: nextSequence++,
      });
      observationIds.push(observationId);
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
    return { episodeId: episode.id, observationIds, inserted, duplicates, stale, environmentStale };
  });

  // World State is a derived read-only projection. Its failure must not
  // change the already-committed observation or acceptance outcome.
  if (input.materializeWorldState !== false) {
    try {
      await materializeWorldStateForProject(input.projectId);
      // World State is a first-class context slice. Invalidate only that slice
      // so unrelated project context remains reusable.
      invalidateContextSlice(input.projectId, "worldState");
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
  }

  return result;
}