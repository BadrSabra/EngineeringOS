import { and, asc, eq, inArray, notExists } from "drizzle-orm";
import {
  AgentEffectSchema,
  StrategyCandidateSchema,
  canonicalJsonHash,
  type JsonValue,
  type StrategyCandidate,
} from "@workspace/ai-orchestrator";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiStrategyCandidatesTable,
  aiStrategyReplayCaseRunsTable,
  aiStrategyReplayCasesTable,
  db,
  projectsTable,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  computeAcceptedStrategyKey,
  expectedEffectNamesFromParsedEffects,
  parseAcceptedActionRequest,
} from "./strategy-candidate-extractor.js";
import { materializeStrategyReplayCaseProofBinding } from "./strategy-replay-case-proof.js";

type StrategyReplayCaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SOURCE_REVISION = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;
const BOUNDED_ID = z.string().min(1).max(200);

export const RegisteredStrategyReplayCaseDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: BOUNDED_ID,
  projectId: BOUNDED_ID,
  candidateId: BOUNDED_ID,
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.string().regex(SOURCE_REVISION),
  sourceEpisodeId: BOUNDED_ID,
  sourceExecutionId: BOUNDED_ID,
  sourceAttempt: z.number().int().nonnegative(),
  acceptanceId: BOUNDED_ID,
  effectBundleId: BOUNDED_ID,
  sourceCanonicalProofHash: z.string().regex(/^[a-f0-9]{64}$/),
  actionId: BOUNDED_ID,
  capabilityId: BOUNDED_ID,
  actionContractHash: z.string().regex(/^[a-f0-9]{64}$/),
  recipeId: BOUNDED_ID,
}).strict();

export type RegisteredStrategyReplayCaseDefinition =
  z.infer<typeof RegisteredStrategyReplayCaseDefinitionSchema>;

export type ProspectiveStrategyReplayCaseRegistration =
  | {
      status: "registered" | "already_registered";
      caseId: string;
      candidateId: string;
    }
  | {
      status: "skipped";
      reason:
        | "project_not_opted_in"
        | "source_proof_unverified"
        | "episode_not_eligible"
        | "action_events_incomplete"
        | "action_contract_invalid"
        | "action_commit_mismatch"
        | "effect_evidence_incomplete"
        | "no_pending_candidate"
        | "candidate_mismatch"
        | "ambiguous_candidate";
    };

export async function deleteUnreplayedStrategyReplayCases(
  tx: StrategyReplayCaseTransaction,
  projectId: string,
): Promise<number> {
  const removed = await tx.delete(aiStrategyReplayCasesTable)
    .where(and(
      eq(aiStrategyReplayCasesTable.projectId, projectId),
      notExists(
        tx.select({ id: aiStrategyReplayCaseRunsTable.id })
          .from(aiStrategyReplayCaseRunsTable)
          .where(eq(
            aiStrategyReplayCaseRunsTable.caseRegistrationId,
            aiStrategyReplayCasesTable.id,
          )),
      ),
    ))
    .returning({ id: aiStrategyReplayCasesTable.id });
  return removed.length;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJsonHash(left as JsonValue) === canonicalJsonHash(right as JsonValue);
  } catch {
    return false;
  }
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value as string[];
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && right.every((value) => left.includes(value));
}

function matchesCandidateSemantics(input: {
  candidate: StrategyCandidate;
  action: NonNullable<ReturnType<typeof parseAcceptedActionRequest>>;
  expectedEffectNames: string[];
  intentKind: string;
}): boolean {
  const { candidate, action, expectedEffectNames, intentKind } = input;
  return sameJson(candidate.triggerConditions, action.triggerConditions)
    && sameJson(candidate.preconditions, action.preconditions)
    && sameJson(candidate.recommendedActionOrder, [action.capabilityId])
    && sameJson(candidate.expectedEffects, expectedEffectNames)
    && sameJson(candidate.failureSemantics ?? [], action.failureSemantics)
    && sameJson(candidate.applicableScopes, [intentKind])
    && sameJson(candidate.observationRequirements, [{
      kind: "direct_before_after",
      profile: action.observationProfile,
      completeness: "complete",
      freshness: "fresh",
    }]);
}

/**
 * Registers only a future accepted recipe episode that exactly matches one
 * frozen pending-replay candidate. Callers invoke this only after the strategy
 * extractor rejects the episode as new support because candidate evaluation
 * has started. The row contains IDs and hashes only, never prompt or file data.
 */
export async function registerProspectiveStrategyReplayCase(input: {
  projectId: string;
  episodeId: string;
}): Promise<ProspectiveStrategyReplayCaseRegistration> {
  const [consent] = await db.select({
    strategyReplayOptIn: projectsTable.strategyReplayOptIn,
  }).from(projectsTable).where(eq(projectsTable.id, input.projectId)).limit(1);
  if (!consent?.strategyReplayOptIn) {
    return { status: "skipped", reason: "project_not_opted_in" };
  }

  const proofResult = await materializeStrategyReplayCaseProofBinding(input);
  if (proofResult.status !== "verified") {
    return { status: "skipped", reason: "source_proof_unverified" };
  }

  return db.transaction(async (tx) => {
    const [project] = await tx.select({
      strategyReplayOptIn: projectsTable.strategyReplayOptIn,
    }).from(projectsTable).where(eq(projectsTable.id, input.projectId)).for("update");
    if (!project?.strategyReplayOptIn) {
      return { status: "skipped", reason: "project_not_opted_in" };
    }

    const [episode] = await tx.select().from(aiAgentEpisodesTable).where(and(
      eq(aiAgentEpisodesTable.id, input.episodeId),
      eq(aiAgentEpisodesTable.projectId, input.projectId),
    )).for("update");
    if (
      !episode
      || episode.state !== "completed"
      || episode.verdict !== "achieved"
      || !episode.closedAt
      || !SOURCE_REVISION.test(episode.projectRevision)
      || episode.projectRevision !== proofResult.binding.sourceRevision
    ) {
      return { status: "skipped", reason: "episode_not_eligible" };
    }
    const episodeScope = asRecord(episode.scope);
    if (asRecord(episodeScope?.strategyReplayCase)) {
      return { status: "skipped", reason: "episode_not_eligible" };
    }

    const events = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
      eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
    )).orderBy(asc(aiAgentEpisodeEventsTable.sequence));
    const requests = events.filter((event) => event.eventType === "ACTION_REQUESTED");
    const commits = events.filter((event) => event.eventType === "ACTION_COMMITTED");
    if (requests.length !== 1 || commits.length !== 1) {
      return { status: "skipped", reason: "action_events_incomplete" };
    }

    const requestPayload = asRecord(requests[0]?.payload);
    const action = parseAcceptedActionRequest(requestPayload);
    const actionContractHash = requestPayload?.actionContractHash;
    const trigger = action?.triggerConditions.length === 1
      ? asRecord(action.triggerConditions[0])
      : undefined;
    const recipeId = trigger?.kind === "server_recipe" && typeof trigger.recipeId === "string"
      ? trigger.recipeId
      : undefined;
    const commitPayload = asRecord(commits[0]?.payload);
    if (
      !action
      || typeof actionContractHash !== "string"
      || !/^[a-f0-9]{64}$/.test(actionContractHash)
      || !recipeId
    ) {
      return { status: "skipped", reason: "action_contract_invalid" };
    }
    if (
      commitPayload?.actionId !== action.actionId
      || commitPayload.capabilityId !== action.capabilityId
      || !["completed", "passed"].includes(String(commitPayload.status))
    ) {
      return { status: "skipped", reason: "action_commit_mismatch" };
    }

    const [bundle] = await tx.select().from(aiAgentEffectBundlesTable).where(and(
      eq(aiAgentEffectBundlesTable.id, proofResult.binding.effectBundleId),
      eq(aiAgentEffectBundlesTable.projectId, input.projectId),
      eq(aiAgentEffectBundlesTable.executionId, proofResult.binding.executionId),
      eq(aiAgentEffectBundlesTable.attempt, proofResult.binding.attempt),
      eq(aiAgentEffectBundlesTable.episodeId, episode.id),
    )).for("update");
    const effectIds = stringArray(bundle?.effectIds);
    const contractHashes = stringArray(bundle?.effectContractHashes);
    if (!bundle || !effectIds?.length || !contractHashes?.length) {
      return { status: "skipped", reason: "effect_evidence_incomplete" };
    }

    const effectRows = await tx.select().from(aiAgentEffectsTable).where(and(
      eq(aiAgentEffectsTable.projectId, input.projectId),
      eq(aiAgentEffectsTable.executionId, proofResult.binding.executionId),
      eq(aiAgentEffectsTable.episodeId, episode.id),
      eq(aiAgentEffectsTable.attempt, proofResult.binding.attempt),
      inArray(aiAgentEffectsTable.id, effectIds),
    ));
    const parsedEffects = effectRows.map((row) => AgentEffectSchema.safeParse({
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
      effectRows.length !== effectIds.length
      || parsedEffects.some((parsed) => !parsed.success)
      || effectRows.some((row) =>
        row.actionId !== action.actionId
        || row.capabilityId !== action.capabilityId
        || row.status !== "observed"
        || !contractHashes.includes(row.effectContractHash))
      || !sameStringSet(
        parsedEffects.flatMap((parsed) => parsed.success ? [parsed.data.effectId] : []),
        effectIds,
      )
    ) {
      return { status: "skipped", reason: "effect_evidence_incomplete" };
    }
    const expectedEffectNames = expectedEffectNamesFromParsedEffects(
      parsedEffects.flatMap((parsed) => parsed.success ? [parsed.data] : []),
    );
    if (!expectedEffectNames) {
      return { status: "skipped", reason: "effect_evidence_incomplete" };
    }
    const strategyKey = computeAcceptedStrategyKey({
      projectId: input.projectId,
      sourceRevision: episode.projectRevision,
      intentKind: episode.intentKind,
      action,
      expectedEffectNames,
    });

    const candidates = await tx.select().from(aiStrategyCandidatesTable).where(and(
      eq(aiStrategyCandidatesTable.projectId, input.projectId),
      eq(aiStrategyCandidatesTable.sourceRevision, episode.projectRevision),
      eq(aiStrategyCandidatesTable.strategyKey, strategyKey),
      eq(aiStrategyCandidatesTable.evaluationStatus, "pending_replay"),
    )).for("update");
    if (candidates.length === 0) {
      return { status: "skipped", reason: "no_pending_candidate" };
    }
    if (candidates.length !== 1) {
      return { status: "skipped", reason: "ambiguous_candidate" };
    }

    const [candidateRow] = candidates;
    const parsedCandidate = StrategyCandidateSchema.safeParse(candidateRow?.candidate);
    const databaseSupport = stringArray(candidateRow?.supportingEpisodeIds);
    const candidate = parsedCandidate.success
      ? parsedCandidate.data as StrategyCandidate
      : undefined;
    if (
      !candidate
      || !databaseSupport
      || candidate.candidateId !== candidateRow?.id
      || candidate.evaluationStatus !== "pending_replay"
      || canonicalJsonHash(candidate as unknown as JsonValue) !== candidateRow?.candidateHash
      || !sameJson([...new Set(databaseSupport)].sort(), [...new Set(candidate.supportingEpisodeIds)].sort())
    ) {
      return { status: "skipped", reason: "candidate_mismatch" };
    }
    if (candidate.supportingEpisodeIds.includes(episode.id)) {
      return { status: "skipped", reason: "candidate_mismatch" };
    }
    if (episode.closedAt.getTime() <= candidateRow.updatedAt.getTime()) {
      return { status: "skipped", reason: "candidate_mismatch" };
    }
    if (!matchesCandidateSemantics({
      candidate,
      action,
      expectedEffectNames,
      intentKind: episode.intentKind,
    })) {
      return { status: "skipped", reason: "candidate_mismatch" };
    }

    const definition = RegisteredStrategyReplayCaseDefinitionSchema.safeParse({
      schemaVersion: 1,
      caseId: proofResult.binding.caseId,
      projectId: input.projectId,
      candidateId: candidateRow.id,
      candidateHash: candidateRow.candidateHash,
      sourceRevision: episode.projectRevision,
      sourceEpisodeId: episode.id,
      sourceExecutionId: proofResult.binding.executionId,
      sourceAttempt: proofResult.binding.attempt,
      acceptanceId: proofResult.binding.acceptanceId,
      effectBundleId: proofResult.binding.effectBundleId,
      sourceCanonicalProofHash: proofResult.binding.sourceCanonicalProofHash,
      actionId: action.actionId,
      capabilityId: action.capabilityId,
      actionContractHash,
      recipeId,
    });
    if (!definition.success) {
      return { status: "skipped", reason: "candidate_mismatch" };
    }

    const registrationId = `strategy-replay-registration:${canonicalJsonHash({
      projectId: input.projectId,
      candidateId: candidateRow.id,
      candidateHash: candidateRow.candidateHash,
      sourceEpisodeId: episode.id,
    } as unknown as JsonValue)}`;
    const [inserted] = await tx.insert(aiStrategyReplayCasesTable).values({
      id: registrationId,
      projectId: input.projectId,
      candidateId: candidateRow.id,
      sourceEpisodeId: episode.id,
      caseDefinition: definition.data as unknown as JsonValue,
    }).onConflictDoNothing().returning({ id: aiStrategyReplayCasesTable.id });

    if (!inserted) {
      return {
        status: "already_registered",
        caseId: registrationId,
        candidateId: candidateRow.id,
      };
    }
    return {
      status: "registered",
      caseId: registrationId,
      candidateId: candidateRow.id,
    };
  });
}