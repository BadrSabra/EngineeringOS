import { and, eq, inArray } from "drizzle-orm";
import {
  canonicalJsonHash,
  type JsonValue,
  StrategyReplayCaseProofBindingSchema,
  type StrategyReplayCaseProofBinding,
} from "@workspace/ai-orchestrator";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";
import { loadCanonicalProof } from "../proof-foundation.js";

const SOURCE_REVISION = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

export type StrategyReplayCaseProofBindingResult =
  | {
      status: "verified";
      binding: StrategyReplayCaseProofBinding;
    }
  | {
      status: "not_eligible";
      reason:
        | "episode_not_found"
        | "episode_not_accepted"
        | "execution_identity_mismatch"
        | "acceptance_not_proven"
        | "effect_bundle_mismatch"
        | "effect_evidence_incomplete"
        | "canonical_proof_not_proven"
        | "source_revision_invalid"
        | "source_identity_invalid"
        | "canonical_proof_hash_unavailable"
        | "invalid_binding"
        | "binding_mismatch";
    };

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value as string[];
}

function invalid(
  reason: Extract<StrategyReplayCaseProofBindingResult, { status: "not_eligible" }>["reason"],
): StrategyReplayCaseProofBindingResult {
  return { status: "not_eligible", reason };
}

/**
 * Recomputes the source-proof binding for a closed accepted episode. This is
 * only an identity/evidence adapter for a future server-owned corpus resolver:
 * it does not establish that the episode is a registered replay case, execute
 * a candidate, or create a replay receipt.
 */
export async function materializeStrategyReplayCaseProofBinding(input: {
  projectId: string;
  episodeId: string;
}): Promise<StrategyReplayCaseProofBindingResult> {
  return db.transaction(async (tx) => {
    const [episode] = await tx
      .select()
      .from(aiAgentEpisodesTable)
      .where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
      ))
      .for("update");
    if (!episode) return invalid("episode_not_found");
    if (
      episode.state !== "completed"
      || episode.verdict !== "achieved"
      || !episode.closedAt
    ) {
      return invalid("episode_not_accepted");
    }
    if (!SOURCE_REVISION.test(episode.projectRevision)) {
      return invalid("source_revision_invalid");
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
      return invalid("execution_identity_mismatch");
    }

    const [acceptance] = await tx
      .select()
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, execution.id),
        eq(aiExecutionAcceptancesTable.projectId, input.projectId),
        eq(aiExecutionAcceptancesTable.attempt, episode.attempt),
      ))
      .limit(1)
      .for("update");
    if (
      !acceptance
      || acceptance.outcome !== "SUCCEEDED"
      || acceptance.terminalStatus !== "completed"
      || acceptance.sourceRevision !== episode.projectRevision
      || !acceptance.effectBundleId
    ) {
      return invalid("acceptance_not_proven");
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
    const effectIds = bundle ? stringArray(bundle.effectIds) : undefined;
    const effectContractHashes = bundle
      ? stringArray(bundle.effectContractHashes)
      : undefined;
    if (
      !bundle
      || bundle.verdict !== "OBSERVED"
      || !effectIds
      || effectIds.length === 0
      || new Set(effectIds).size !== effectIds.length
      || !effectContractHashes
      || effectContractHashes.length !== effectIds.length
    ) {
      return invalid("effect_bundle_mismatch");
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
    if (
      effectRows.length !== effectIds.length
      || effectRows.some((effect) =>
        effect.status !== "observed"
        || !effectContractHashes.includes(effect.effectContractHash))
    ) {
      return invalid("effect_bundle_mismatch");
    }

    const observationIds: string[] = [];
    for (const effect of effectRows) {
      const beforeIds = stringArray(effect.beforeObservationIds);
      const afterIds = stringArray(effect.afterObservationIds);
      const evidenceRefs = stringArray(effect.evidenceRefs);
      const missingEffects = stringArray(effect.missingEffects);
      const contradictionRefs = stringArray(effect.contradictionRefs);
      if (
        !beforeIds || beforeIds.length === 0
        || !afterIds || afterIds.length === 0
        || !evidenceRefs || evidenceRefs.length === 0
        || !missingEffects || missingEffects.length > 0
        || !contradictionRefs || contradictionRefs.length > 0
      ) {
        return invalid("effect_evidence_incomplete");
      }
      observationIds.push(...beforeIds, ...afterIds);
    }

    const uniqueObservationIds = [...new Set(observationIds)];
    const observationRows = await tx
      .select()
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, input.projectId),
        eq(aiAgentObservationsTable.executionId, execution.id),
        eq(aiAgentObservationsTable.episodeId, episode.id),
        inArray(aiAgentObservationsTable.id, uniqueObservationIds),
      ));
    if (
      uniqueObservationIds.length === 0
      || observationRows.length !== uniqueObservationIds.length
      || observationRows.some((observation) =>
        observation.provenance !== "DIRECT_OBSERVATION"
        || observation.completeness !== "complete"
        || observation.freshness !== "fresh"
        || observation.projectRevision !== episode.projectRevision
        || !Array.isArray(observation.evidenceRefs)
        || observation.evidenceRefs.length === 0)
    ) {
      return invalid("effect_evidence_incomplete");
    }

    const deliveryRequired = effectRows.some((effect) =>
      effect.capabilityId.startsWith("github.push."));
    const proof = await loadCanonicalProof({
      tx,
      executionId: execution.id,
      goalStatus: "completed",
      deliveryRequired,
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
      || proof.attempt !== episode.attempt
    ) {
      return invalid("canonical_proof_not_proven");
    }

    let sourceCanonicalProofHash: string;
    try {
      sourceCanonicalProofHash = canonicalJsonHash(
        JSON.parse(JSON.stringify(proof)) as JsonValue,
      );
    } catch {
      return invalid("canonical_proof_hash_unavailable");
    }

    const caseId = `strategy-case:${canonicalJsonHash({
      kind: "strategy-replay-source-case",
      version: 1,
      projectId: input.projectId,
      sourceRevision: episode.projectRevision,
      sourceEpisodeId: episode.id,
    } as unknown as JsonValue)}`;
    const parsed = StrategyReplayCaseProofBindingSchema.safeParse({
      caseId,
      projectId: input.projectId,
      sourceRevision: episode.projectRevision,
      sourceEpisodeId: episode.id,
      executionId: execution.id,
      attempt: episode.attempt,
      acceptanceId: acceptance.id,
      effectBundleId: bundle.id,
      sourceCanonicalProofHash,
    });
    if (!parsed.success) return invalid("source_identity_invalid");
    return { status: "verified", binding: parsed.data };
  });
}

/**
 * Verifies an incoming binding against the current durable episode, acceptance,
 * effect, observation, and Canonical Proof rows. The incoming digest is never
 * treated as proof on its own.
 */
export async function verifyStrategyReplayCaseProofBinding(
  value: unknown,
): Promise<StrategyReplayCaseProofBindingResult> {
  const parsed = StrategyReplayCaseProofBindingSchema.safeParse(value);
  if (!parsed.success) return invalid("invalid_binding");

  const actual = await materializeStrategyReplayCaseProofBinding({
    projectId: parsed.data.projectId,
    episodeId: parsed.data.sourceEpisodeId,
  });
  if (actual.status !== "verified") return actual;

  const suppliedHash = canonicalJsonHash(parsed.data as unknown as JsonValue);
  const recomputedHash = canonicalJsonHash(actual.binding as unknown as JsonValue);
  if (suppliedHash !== recomputedHash) return invalid("binding_mismatch");
  return actual;
}