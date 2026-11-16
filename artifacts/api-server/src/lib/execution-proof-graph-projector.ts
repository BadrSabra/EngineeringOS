import { and, asc, eq, inArray } from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceReadsTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";
import {
  canonicalJsonHash,
  executionProofGraphEdgeId,
  executionProofGraphId,
  executionProofGraphNodeId,
  hashObservationValue,
  validateExecutionProofGraph,
  type ExecutionProofGraph,
  type ExecutionProofGraphEdgeInput,
  type ExecutionProofGraphNode,
} from "@workspace/ai-orchestrator";
import {
  normalizeStoredRuntimeStartGateCProofArtifact,
  RUNTIME_START_GATE_C_PROOF_MODE,
} from "./runtime-start-gate-c-proof.js";
import { loadCanonicalProof } from "./proof-foundation.js";

type ProjectorTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProjectExecutionProofGraphInput = {
  projectId: string;
  executionId: string;
  expectedAttempt: number;
};

export type ProjectedCanonicalProofSummary = {
  accepted: true;
  verdict: "PROVEN";
  executionId: string;
  acceptanceId: string;
  evidenceSnapshotId: string;
  attempt: number;
  operationId: string;
  sourceRevision: string;
  candidateIdentity: string | null;
};

export type ExecutionProofGraphProjectorReason =
  | "EXECUTION_NOT_FOUND"
  | "ATTEMPT_MISMATCH"
  | "EXECUTION_NOT_COMPLETED"
  | "UNSUPPORTED_PROOF_MODE"
  | "ACCEPTANCE_MISSING"
  | "EVIDENCE_SNAPSHOT_MISSING"
  | "EVIDENCE_INCOMPLETE"
  | "CANONICAL_PROOF_REJECTED"
  | "DOMAIN_PROOF_MISMATCH"
  | "SOURCE_ROWS_MISSING"
  | "SOURCE_HASH_MISMATCH"
  | "IDENTITY_MISMATCH"
  | "REVISION_MISMATCH"
  | "GRAPH_INVALID";

export type ExecutionProofGraphProjectorResult =
  | {
      kind: "NOT_PROJECTABLE";
      authority: "READ_ONLY_PROJECTION";
      executionId: string;
      expectedAttempt: number;
      reasons: ExecutionProofGraphProjectorReason[];
    }
  | {
      kind: "PROJECTED";
      authority: "READ_ONLY_PROJECTION";
      graph: ExecutionProofGraph;
      graphHash: string;
      canonicalProof: ProjectedCanonicalProofSummary;
      structuralValidation: ReturnType<typeof validateExecutionProofGraph>;
    };

function notProjectable(
  input: ProjectExecutionProofGraphInput,
  reason: ExecutionProofGraphProjectorReason,
): ExecutionProofGraphProjectorResult {
  return {
    kind: "NOT_PROJECTABLE",
    authority: "READ_ONLY_PROJECTION",
    executionId: input.executionId,
    expectedAttempt: input.expectedAttempt,
    reasons: [reason],
  };
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseStoredRequest(raw: string): Record<string, unknown> | undefined {
  try {
    return jsonRecord(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function makeNode<T extends ExecutionProofGraphNode>(
  node: Omit<T, "id">,
  sourceId: string,
): T {
  return {
    ...node,
    id: executionProofGraphNodeId(node.kind, sourceId),
  } as T;
}

function makeEdge(edge: ExecutionProofGraphEdgeInput) {
  return { ...edge, id: executionProofGraphEdgeId(edge) };
}

function asNonEmpty(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function canonicalFailureReason(
  failureReasons: readonly string[],
): ExecutionProofGraphProjectorReason {
  if (failureReasons.includes("evidence_incomplete")) {
    return "EVIDENCE_INCOMPLETE";
  }
  if (failureReasons.includes("runtime_start_gate_c_proof_mismatch")) {
    return "DOMAIN_PROOF_MISMATCH";
  }
  if (failureReasons.includes("source_revision_mismatch")
    || failureReasons.includes("missing_source_revision")
    || failureReasons.includes("missing_evidence_source_revision")) {
    return "REVISION_MISMATCH";
  }
  if (failureReasons.includes("evidence_snapshot_mismatch")
    || failureReasons.includes("candidate_identity_mismatch")
    || failureReasons.includes("execution_identity_mismatch")
    || failureReasons.includes("acceptance_execution_mismatch")
    || failureReasons.includes("acceptance_attempt_mismatch")) {
    return "IDENTITY_MISMATCH";
  }
  return "CANONICAL_PROOF_REJECTED";
}

function buildGraphEdges(graph: Pick<ExecutionProofGraph, "nodes">) {
  const node = (kind: ExecutionProofGraphNode["kind"]) => graph.nodes.find((item) => item.kind === kind);
  const execution = node("EXECUTION");
  const acceptance = node("ACCEPTANCE");
  const snapshot = node("EVIDENCE_SNAPSHOT");
  const artifact = node("GATE_C_ARTIFACT");
  const episode = node("EPISODE");
  const bundle = node("EFFECT_BUNDLE");
  const effect = node("EFFECT");
  if (
    execution?.kind !== "EXECUTION"
    || acceptance?.kind !== "ACCEPTANCE"
    || snapshot?.kind !== "EVIDENCE_SNAPSHOT"
    || artifact?.kind !== "GATE_C_ARTIFACT"
    || episode?.kind !== "EPISODE"
    || bundle?.kind !== "EFFECT_BUNDLE"
    || effect?.kind !== "EFFECT"
  ) return [];

  const events = graph.nodes.filter((item) => item.kind === "ACTION_EVENT");
  const observations = graph.nodes.filter((item) => item.kind === "OBSERVATION");
  return [
    makeEdge({ type: "EXECUTION_HAS_ACCEPTANCE", from: execution.id, to: acceptance.id }),
    makeEdge({ type: "ACCEPTANCE_HAS_SNAPSHOT", from: acceptance.id, to: snapshot.id }),
    makeEdge({ type: "EXECUTION_HAS_EPISODE", from: execution.id, to: episode.id }),
    makeEdge({ type: "EPISODE_HAS_EFFECT_BUNDLE", from: episode.id, to: bundle.id }),
    makeEdge({ type: "BUNDLE_HAS_EFFECT", from: bundle.id, to: effect.id }),
    makeEdge({ type: "SNAPSHOT_HAS_ARTIFACT", from: snapshot.id, to: artifact.id }),
    ...events.map((event) => makeEdge({
      type: "EPISODE_HAS_EVENT",
      from: episode.id,
      to: event.id,
    })),
    ...events.map((event) => makeEdge({
      type: "ARTIFACT_BINDS_EVENT",
      from: artifact.id,
      to: event.id,
    })),
    makeEdge({
      type: "ARTIFACT_BINDS_EFFECT_BUNDLE",
      from: artifact.id,
      to: bundle.id,
    }),
    makeEdge({ type: "ARTIFACT_BINDS_EFFECT", from: artifact.id, to: effect.id }),
    ...observations.flatMap((observation) => observation.kind === "OBSERVATION"
      ? [
          makeEdge({
            type: "EFFECT_HAS_OBSERVATION",
            from: effect.id,
            to: observation.id,
            role: observation.observationRole,
          }),
          makeEdge({
            type: "ARTIFACT_BINDS_OBSERVATION",
            from: artifact.id,
            to: observation.id,
            role: observation.observationRole,
          }),
        ]
      : []),
  ];
}

/**
 * Read-only Gate C projector. Call inside the caller's database transaction;
 * the exact execution, acceptance, snapshot, and verifier input rows remain
 * locked until that transaction ends.
 */
export async function projectExecutionProofGraph(
  tx: ProjectorTransaction,
  input: ProjectExecutionProofGraphInput,
): Promise<ExecutionProofGraphProjectorResult> {
  if (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 0) {
    return notProjectable(input, "ATTEMPT_MISMATCH");
  }

  const [execution] = await tx.select().from(aiExecutionsTable).where(and(
    eq(aiExecutionsTable.id, input.executionId),
    eq(aiExecutionsTable.projectId, input.projectId),
  )).for("update").limit(1);
  if (!execution) return notProjectable(input, "EXECUTION_NOT_FOUND");
  if (execution.attempt !== input.expectedAttempt) {
    return notProjectable(input, "ATTEMPT_MISMATCH");
  }
  if (execution.status !== "completed") {
    return notProjectable(input, "EXECUTION_NOT_COMPLETED");
  }

  const request = parseStoredRequest(execution.request);
  if (request?.recipeProofMode !== RUNTIME_START_GATE_C_PROOF_MODE) {
    return notProjectable(input, "UNSUPPORTED_PROOF_MODE");
  }
  const operationId = asNonEmpty(execution.operationId);
  const sourceRevision = asNonEmpty(execution.baseRevision);
  if (!operationId || !sourceRevision) {
    return notProjectable(input, "IDENTITY_MISMATCH");
  }

  const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable).where(and(
    eq(aiExecutionAcceptancesTable.executionId, execution.id),
    eq(aiExecutionAcceptancesTable.projectId, input.projectId),
    eq(aiExecutionAcceptancesTable.attempt, input.expectedAttempt),
  )).for("update").limit(1);
  if (!acceptance) return notProjectable(input, "ACCEPTANCE_MISSING");
  if (!acceptance.evidenceSnapshotId) {
    return notProjectable(input, "EVIDENCE_SNAPSHOT_MISSING");
  }
  const [evidence] = await tx.select().from(aiExecutionEvidenceSnapshotsTable).where(and(
    eq(aiExecutionEvidenceSnapshotsTable.id, acceptance.evidenceSnapshotId),
    eq(aiExecutionEvidenceSnapshotsTable.executionId, execution.id),
    eq(aiExecutionEvidenceSnapshotsTable.projectId, input.projectId),
    eq(aiExecutionEvidenceSnapshotsTable.attempt, input.expectedAttempt),
  )).for("update").limit(1);
  if (!evidence) return notProjectable(input, "EVIDENCE_SNAPSHOT_MISSING");

  const candidateIdentity = acceptance.candidateIdentity ?? null;
  const canonicalProofInput = {
    tx,
    executionId: execution.id,
    goalStatus: "completed",
    attempt: input.expectedAttempt,
    scope: {
      projectId: input.projectId,
      executionId: execution.id,
      operationId,
      sourceRevisionBinding: "execution" as const,
      candidateIdentityBinding: candidateIdentity === null ? "not_applicable" as const : "required" as const,
      sourceRevision,
      ...(candidateIdentity ? { candidateIdentity } : {}),
    },
  };
  const initialCanonicalProof = await loadCanonicalProof(canonicalProofInput);
  if (!initialCanonicalProof.accepted || initialCanonicalProof.verdict !== "PROVEN") {
    return notProjectable(input, canonicalFailureReason(initialCanonicalProof.failureReasons));
  }

  const artifactRefs = Array.isArray(evidence.artifactRefs) ? evidence.artifactRefs : [];
  const storedGateCArtifacts = artifactRefs.filter((value) => (
    jsonRecord(value)?.kind === "runtime_start_gate_c"
  ));
  const storedArtifact = storedGateCArtifacts.length === 1
    ? normalizeStoredRuntimeStartGateCProofArtifact(storedGateCArtifacts[0])
    : undefined;
  if (!storedArtifact) return notProjectable(input, "DOMAIN_PROOF_MISMATCH");

  const evidenceReads = await tx.select({ id: aiExecutionEvidenceReadsTable.id })
    .from(aiExecutionEvidenceReadsTable)
    .where(eq(aiExecutionEvidenceReadsTable.snapshotId, evidence.id))
    .for("share");
  if (evidence.readCount !== 0 || evidence.totalBytes !== 0 || evidenceReads.length !== 0
    || artifactRefs.length !== 1) {
    return notProjectable(input, "IDENTITY_MISMATCH");
  }

  const beforeObservationIds = storedArtifact.beforeObservationIds;
  const afterObservationIds = storedArtifact.afterObservationIds;
  const observationIds = [...beforeObservationIds, ...afterObservationIds];
  const [episode] = await tx.select().from(aiAgentEpisodesTable).where(and(
    eq(aiAgentEpisodesTable.id, storedArtifact.episodeId),
    eq(aiAgentEpisodesTable.projectId, input.projectId),
    eq(aiAgentEpisodesTable.executionId, execution.id),
    eq(aiAgentEpisodesTable.attempt, input.expectedAttempt),
  )).for("share").limit(1);
  const events = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
    eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
    eq(aiAgentEpisodeEventsTable.executionId, execution.id),
    eq(aiAgentEpisodeEventsTable.attempt, input.expectedAttempt),
    eq(aiAgentEpisodeEventsTable.episodeId, storedArtifact.episodeId),
    inArray(aiAgentEpisodeEventsTable.id, [
      storedArtifact.actionEventId,
      storedArtifact.committedEventId,
    ]),
  )).orderBy(asc(aiAgentEpisodeEventsTable.id)).for("share");
  const [effectBundle] = await tx.select().from(aiAgentEffectBundlesTable).where(and(
    eq(aiAgentEffectBundlesTable.id, storedArtifact.effectBundleId),
    eq(aiAgentEffectBundlesTable.projectId, input.projectId),
    eq(aiAgentEffectBundlesTable.executionId, execution.id),
    eq(aiAgentEffectBundlesTable.attempt, input.expectedAttempt),
    eq(aiAgentEffectBundlesTable.episodeId, storedArtifact.episodeId),
  )).for("share").limit(1);
  const [effect] = await tx.select().from(aiAgentEffectsTable).where(and(
    eq(aiAgentEffectsTable.id, storedArtifact.effectId),
    eq(aiAgentEffectsTable.projectId, input.projectId),
    eq(aiAgentEffectsTable.executionId, execution.id),
    eq(aiAgentEffectsTable.attempt, input.expectedAttempt),
    eq(aiAgentEffectsTable.episodeId, storedArtifact.episodeId),
  )).for("share").limit(1);
  const observations = await tx.select().from(aiAgentObservationsTable).where(and(
    eq(aiAgentObservationsTable.projectId, input.projectId),
    eq(aiAgentObservationsTable.executionId, execution.id),
    eq(aiAgentObservationsTable.episodeId, storedArtifact.episodeId),
    inArray(aiAgentObservationsTable.id, observationIds),
  )).orderBy(asc(aiAgentObservationsTable.id)).for("share");
  if (
    !episode
    || events.length !== 2
    || !effectBundle
    || !effect
    || observations.length !== observationIds.length
  ) {
    return notProjectable(input, "SOURCE_ROWS_MISSING");
  }

  for (const observation of observations) {
    let recomputedHash: string;
    try {
      recomputedHash = hashObservationValue(
        observation.value as Parameters<typeof hashObservationValue>[0],
      );
    } catch {
      return notProjectable(input, "SOURCE_HASH_MISMATCH");
    }
    if (recomputedHash !== observation.valueHash) {
      return notProjectable(input, "SOURCE_HASH_MISMATCH");
    }
  }

  // The initial canonical reload acquired the primary row locks. Once the
  // domain rows are also share-locked, reload Canonical Proof so an intervening
  // writer cannot produce a mixed snapshot between proof verification and
  // graph construction.
  const canonicalProof = await loadCanonicalProof(canonicalProofInput);
  if (!canonicalProof.accepted || canonicalProof.verdict !== "PROVEN") {
    return notProjectable(input, canonicalFailureReason(canonicalProof.failureReasons));
  }

  const sourceRevisionIdentity = {
    sourceRevisionKind: storedArtifact.sourceRevisionKind,
    sourceRevisionSource: storedArtifact.sourceRevisionSource,
  };
  const nodes: ExecutionProofGraphNode[] = [
    makeNode<Extract<ExecutionProofGraphNode, { kind: "EXECUTION" }>>({
      kind: "EXECUTION",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: execution.attempt,
      operationId,
      proofMode: RUNTIME_START_GATE_C_PROOF_MODE,
      recipeId: "runtime.start",
      recipeVersion: 1,
      status: "completed",
      sourceRevision,
      candidateIdentity,
    }, execution.id),
    makeNode<Extract<ExecutionProofGraphNode, { kind: "ACCEPTANCE" }>>({
      kind: "ACCEPTANCE",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: acceptance.attempt,
      acceptanceId: acceptance.id,
      evidenceSnapshotId: evidence.id,
      effectBundleId: effectBundle.id,
      operationId,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      evidenceRequired: true,
      evidenceComplete: true,
      sourceRevision,
      candidateIdentity,
    }, acceptance.id),
    makeNode<Extract<ExecutionProofGraphNode, { kind: "EVIDENCE_SNAPSHOT" }>>({
      kind: "EVIDENCE_SNAPSHOT",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: evidence.attempt,
      snapshotId: evidence.id,
      operationId,
      verdict: "PROVEN",
      complete: true,
      readCount: 0,
      artifactCount: 1,
      sourceRevision,
      candidateIdentity,
      artifactHash: canonicalJsonHash(storedArtifact as unknown as Parameters<typeof canonicalJsonHash>[0]),
    }, evidence.id),
    makeNode<Extract<ExecutionProofGraphNode, { kind: "GATE_C_ARTIFACT" }>>({
      kind: "GATE_C_ARTIFACT",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: storedArtifact.attempt,
      artifactHash: canonicalJsonHash(storedArtifact as unknown as Parameters<typeof canonicalJsonHash>[0]),
      artifactVersion: 2,
      operationId: storedArtifact.operationId,
      sourceRevision: storedArtifact.sourceRevision,
      sourceRevisionKind: storedArtifact.sourceRevisionKind,
      sourceRevisionSource: storedArtifact.sourceRevisionSource,
      workspaceIdentity: storedArtifact.workspaceIdentity,
      candidateIdentity: storedArtifact.candidateIdentity,
      episodeId: storedArtifact.episodeId,
      actionId: storedArtifact.actionId,
      actionEventId: storedArtifact.actionEventId,
      committedEventId: storedArtifact.committedEventId,
      effectBundleId: storedArtifact.effectBundleId,
      effectId: storedArtifact.effectId,
      actionHash: storedArtifact.actionHash,
      effectContractHash: storedArtifact.effectContractHash,
      environmentRevision: storedArtifact.environmentRevision,
      beforeObservationIds,
      afterObservationIds,
    }, canonicalJsonHash(storedArtifact as unknown as Parameters<typeof canonicalJsonHash>[0])),
    makeNode<Extract<ExecutionProofGraphNode, { kind: "EPISODE" }>>({
      kind: "EPISODE",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: episode.attempt,
      episodeId: episode.id,
      projectRevision: episode.projectRevision,
      state: "completed",
      verdict: "achieved",
      reasonCode: "CANONICAL_PROOF_PROVEN",
    }, episode.id),
    ...events.map((event) => makeNode<Extract<ExecutionProofGraphNode, { kind: "ACTION_EVENT" }>>({
      kind: "ACTION_EVENT",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: event.attempt,
      eventId: event.id,
      eventType: event.eventType as "ACTION_REQUESTED" | "ACTION_COMMITTED",
      actionId: storedArtifact.actionId,
      payloadHash: event.payloadHash,
    }, event.id)),
    makeNode<Extract<ExecutionProofGraphNode, { kind: "EFFECT_BUNDLE" }>>({
      kind: "EFFECT_BUNDLE",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: effectBundle.attempt,
      effectBundleId: effectBundle.id,
      verdict: "OBSERVED",
      effectId: effect.id,
      effectContractHash: effect.effectContractHash,
    }, effectBundle.id),
    makeNode<Extract<ExecutionProofGraphNode, { kind: "EFFECT" }>>({
      kind: "EFFECT",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: effect.attempt,
      effectId: effect.id,
      actionId: effect.actionId,
      capabilityId: "runtime.start",
      status: "observed",
      effectContractHash: effect.effectContractHash,
      beforeObservationIds,
      afterObservationIds,
    }, effect.id),
    ...observations.map((observation) => makeNode<Extract<
      ExecutionProofGraphNode,
      { kind: "OBSERVATION" }
    >>({
      kind: "OBSERVATION",
      projectId: input.projectId,
      executionId: execution.id,
      attempt: input.expectedAttempt,
      observationId: observation.id,
      observationRole: observation.observationRole as "before" | "after",
      predicate: observation.predicate as Extract<
        ExecutionProofGraphNode,
        { kind: "OBSERVATION" }
      >["predicate"],
      provenance: "DIRECT_OBSERVATION",
      completeness: "complete",
      freshness: observation.freshness as "fresh" | "stale" | "unknown",
      environmentFreshness: observation.environmentFreshness as "fresh" | "stale" | "unknown",
      sourceRevision: observation.projectRevision ?? "",
      environmentRevision: observation.environmentRevision ?? "",
      valueHash: observation.valueHash,
    }, observation.id)),
  ];

  const artifactHash = canonicalJsonHash(
    storedArtifact as unknown as Parameters<typeof canonicalJsonHash>[0],
  );
  const graph: ExecutionProofGraph = {
    version: 1,
    profile: "runtime_start_gate_c_v1",
    graphId: executionProofGraphId(input.projectId, execution.id, input.expectedAttempt),
    projectId: input.projectId,
    executionId: execution.id,
    attempt: input.expectedAttempt,
    operationId,
    sourceRevision,
    sourceRevisionKind: sourceRevisionIdentity.sourceRevisionKind,
    sourceRevisionSource: sourceRevisionIdentity.sourceRevisionSource,
    candidateIdentity,
    environmentRevision: storedArtifact.environmentRevision,
    nodes: nodes.map((node) => node.kind === "GATE_C_ARTIFACT"
      ? { ...node, artifactHash }
      : node.kind === "EVIDENCE_SNAPSHOT"
        ? { ...node, artifactHash }
        : node),
    edges: [],
  };
  graph.edges = buildGraphEdges(graph) as ExecutionProofGraph["edges"];

  const validation = validateExecutionProofGraph(graph);
  if (validation.verdict !== "PASS" || !validation.graphHash) {
    return notProjectable(input, "GRAPH_INVALID");
  }
  if (
    !canonicalProof.executionId
    || !canonicalProof.acceptanceId
    || !canonicalProof.evidenceSnapshotId
    || canonicalProof.attempt === null
    || !canonicalProof.operationId
    || !canonicalProof.sourceRevision
  ) {
    return notProjectable(input, "CANONICAL_PROOF_REJECTED");
  }

  return {
    kind: "PROJECTED",
    authority: "READ_ONLY_PROJECTION",
    graph,
    graphHash: validation.graphHash,
    canonicalProof: {
      accepted: true,
      verdict: "PROVEN",
      executionId: canonicalProof.executionId,
      acceptanceId: canonicalProof.acceptanceId,
      evidenceSnapshotId: canonicalProof.evidenceSnapshotId,
      attempt: canonicalProof.attempt,
      operationId: canonicalProof.operationId,
      sourceRevision: canonicalProof.sourceRevision,
      candidateIdentity: canonicalProof.candidateIdentity,
    },
    structuralValidation: validation,
  };
}
