import { describe, expect, it } from "vitest";
import {
  executionProofGraphEdgeId,
  executionProofGraphId,
  executionProofGraphNodeId,
  hashExecutionProofGraph,
  ExecutionProofGraphSchema,
  validateExecutionProofGraph,
  type ExecutionProofGraph,
  type ExecutionProofGraphEdge,
  type ExecutionProofGraphEdgeInput,
  type ExecutionProofGraphNode,
  type ExecutionProofGraphNodeKind,
} from "../agent-state/execution-proof-graph.js";

const projectId = "project-1";
const executionId = "execution-1";
const attempt = 0;
const operationId = "runtime-operation-1";
const sourceRevision = `workspace-tree-v1:${"a".repeat(64)}`;
const environmentRevision = `env-v1:${"b".repeat(64)}`;
const candidateIdentity = null;
const actionId = "action-1";
const effectContractHash = "c".repeat(64);
const beforeObservationIds = ["observation-before-runtime", "observation-before-serving"];
const afterObservationIds = [
  "observation-after-runtime",
  "observation-after-status",
  "observation-after-serving",
];

function makeNode<K extends ExecutionProofGraphNodeKind>(
  kind: K,
  sourceId: string,
  fields: Record<string, unknown>,
): ExecutionProofGraphNode {
  return {
    id: executionProofGraphNodeId(kind, sourceId),
    projectId,
    executionId,
    attempt,
    kind,
    ...fields,
  } as ExecutionProofGraphNode;
}

function makeEdge(
  edge: ExecutionProofGraphEdgeInput,
): ExecutionProofGraphEdge {
  return {
    ...edge,
    id: executionProofGraphEdgeId(edge),
  } as ExecutionProofGraphEdge;
}

function makeValidGraph(): ExecutionProofGraph {
  const execution = makeNode("EXECUTION", executionId, {
    operationId,
    proofMode: "runtime_start_gate_c_v1",
    recipeId: "runtime.start",
    recipeVersion: 1,
    status: "completed",
    sourceRevision,
    candidateIdentity,
  });
  const acceptance = makeNode("ACCEPTANCE", "acceptance-1", {
    acceptanceId: "acceptance-1",
    evidenceSnapshotId: "snapshot-1",
    effectBundleId: "bundle-1",
    operationId,
    outcome: "SUCCEEDED",
    terminalStatus: "completed",
    evidenceRequired: true,
    evidenceComplete: true,
    sourceRevision,
    candidateIdentity,
  });
  const snapshot = makeNode("EVIDENCE_SNAPSHOT", "snapshot-1", {
    snapshotId: "snapshot-1",
    operationId,
    verdict: "PROVEN",
    complete: true,
    readCount: 0,
    artifactCount: 1,
    sourceRevision,
    candidateIdentity,
    artifactHash: "d".repeat(64),
  });
  const artifact = makeNode("GATE_C_ARTIFACT", "d".repeat(64), {
    artifactHash: "d".repeat(64),
    artifactVersion: 2,
    operationId,
    sourceRevision,
    sourceRevisionKind: "workspace_tree",
    sourceRevisionSource: "delivery_tree_digest_v1",
    workspaceIdentity: "8".repeat(64),
    candidateIdentity,
    episodeId: "episode-1",
    actionId,
    actionEventId: "event-requested",
    committedEventId: "event-committed",
    effectBundleId: "bundle-1",
    effectId: "effect-1",
    actionHash: "e".repeat(64),
    effectContractHash,
    environmentRevision,
    beforeObservationIds,
    afterObservationIds,
  });
  const episode = makeNode("EPISODE", "episode-1", {
    episodeId: "episode-1",
    projectRevision: sourceRevision,
    state: "completed",
    verdict: "achieved",
    reasonCode: "CANONICAL_PROOF_PROVEN",
  });
  const requested = makeNode("ACTION_EVENT", "event-requested", {
    eventId: "event-requested",
    eventType: "ACTION_REQUESTED",
    actionId,
    payloadHash: "f".repeat(64),
  });
  const committed = makeNode("ACTION_EVENT", "event-committed", {
    eventId: "event-committed",
    eventType: "ACTION_COMMITTED",
    actionId,
    payloadHash: "1".repeat(64),
  });
  const bundle = makeNode("EFFECT_BUNDLE", "bundle-1", {
    effectBundleId: "bundle-1",
    verdict: "OBSERVED",
    effectId: "effect-1",
    effectContractHash,
  });
  const effect = makeNode("EFFECT", "effect-1", {
    effectId: "effect-1",
    actionId,
    capabilityId: "runtime.start",
    status: "observed",
    effectContractHash,
    beforeObservationIds,
    afterObservationIds,
  });
  const observations = [
    makeNode("OBSERVATION", beforeObservationIds[0]!, {
      observationId: beforeObservationIds[0],
      observationRole: "before",
      predicate: "runtime.before_state",
      provenance: "DIRECT_OBSERVATION",
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      sourceRevision,
      environmentRevision,
      valueHash: "2".repeat(64),
    }),
    makeNode("OBSERVATION", beforeObservationIds[1]!, {
      observationId: beforeObservationIds[1],
      observationRole: "before",
      predicate: "serving.status",
      provenance: "DIRECT_OBSERVATION",
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      sourceRevision,
      environmentRevision,
      valueHash: "3".repeat(64),
    }),
    makeNode("OBSERVATION", afterObservationIds[0]!, {
      observationId: afterObservationIds[0],
      observationRole: "after",
      predicate: "runtime.after_state",
      provenance: "DIRECT_OBSERVATION",
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      sourceRevision,
      environmentRevision,
      valueHash: "4".repeat(64),
    }),
    makeNode("OBSERVATION", afterObservationIds[1]!, {
      observationId: afterObservationIds[1],
      observationRole: "after",
      predicate: "runtime.status",
      provenance: "DIRECT_OBSERVATION",
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      sourceRevision,
      environmentRevision,
      valueHash: "5".repeat(64),
    }),
    makeNode("OBSERVATION", afterObservationIds[2]!, {
      observationId: afterObservationIds[2],
      observationRole: "after",
      predicate: "serving.status",
      provenance: "DIRECT_OBSERVATION",
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      sourceRevision,
      environmentRevision,
      valueHash: "6".repeat(64),
    }),
  ];
  const nodes = [
    execution,
    acceptance,
    snapshot,
    artifact,
    episode,
    requested,
    committed,
    bundle,
    effect,
    ...observations,
  ];
  const edges: ExecutionProofGraphEdge[] = [
    makeEdge({ type: "EXECUTION_HAS_ACCEPTANCE", from: execution.id, to: acceptance.id }),
    makeEdge({ type: "ACCEPTANCE_HAS_SNAPSHOT", from: acceptance.id, to: snapshot.id }),
    makeEdge({ type: "EXECUTION_HAS_EPISODE", from: execution.id, to: episode.id }),
    makeEdge({ type: "EPISODE_HAS_EVENT", from: episode.id, to: requested.id }),
    makeEdge({ type: "EPISODE_HAS_EVENT", from: episode.id, to: committed.id }),
    makeEdge({ type: "EPISODE_HAS_EFFECT_BUNDLE", from: episode.id, to: bundle.id }),
    makeEdge({ type: "BUNDLE_HAS_EFFECT", from: bundle.id, to: effect.id }),
    makeEdge({ type: "SNAPSHOT_HAS_ARTIFACT", from: snapshot.id, to: artifact.id }),
    makeEdge({ type: "ARTIFACT_BINDS_EVENT", from: artifact.id, to: requested.id }),
    makeEdge({ type: "ARTIFACT_BINDS_EVENT", from: artifact.id, to: committed.id }),
    makeEdge({ type: "ARTIFACT_BINDS_EFFECT_BUNDLE", from: artifact.id, to: bundle.id }),
    makeEdge({ type: "ARTIFACT_BINDS_EFFECT", from: artifact.id, to: effect.id }),
    ...observations.flatMap((observation) => {
      if (observation.kind !== "OBSERVATION") return [];
      return [
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
      ];
    }),
  ];
  return {
    version: 1,
    profile: "runtime_start_gate_c_v1",
    graphId: executionProofGraphId(projectId, executionId, attempt),
    projectId,
    executionId,
    attempt,
    operationId,
    sourceRevision,
    sourceRevisionKind: "workspace_tree",
    sourceRevisionSource: "delivery_tree_digest_v1",
    candidateIdentity,
    environmentRevision,
    nodes,
    edges,
  };
}

describe("Mission-free Execution Proof Graph v1", () => {
  it("accepts one structurally complete Gate C graph without granting proof authority", () => {
    const result = validateExecutionProofGraph(makeValidGraph());

    expect(result).toMatchObject({
      validatorVersion: "execution-proof-graph-validator.v1",
      authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY",
      verdict: "PASS",
      violations: [],
    });
    expect(result.graphHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("hashes the same graph independently of node and edge ordering", () => {
    const graph = makeValidGraph();
    const reversed = {
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    };

    expect(hashExecutionProofGraph(graph)).toBe(hashExecutionProofGraph(reversed));
    expect(validateExecutionProofGraph(graph).graphHash)
      .toBe(validateExecutionProofGraph(reversed).graphHash);
    expect(validateExecutionProofGraph(graph).violations)
      .toEqual(validateExecutionProofGraph(reversed).violations);
  });

  it("rejects cross-project, cross-attempt, and revision-mismatched nodes", () => {
    const graph = makeValidGraph();
    const executionNode = graph.nodes.find((node) => node.kind === "EXECUTION")!;
    const acceptanceNode = graph.nodes.find((node) => node.kind === "ACCEPTANCE")!;
    const episodeNode = graph.nodes.find((node) => node.kind === "EPISODE")!;
    const observationNode = graph.nodes.find((node) => node.kind === "OBSERVATION")!;
    const changed = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === executionNode.id
        ? { ...node, projectId: "other-project" }
        : node.id === acceptanceNode.id && node.kind === "ACCEPTANCE"
          ? { ...node, evidenceSnapshotId: "wrong-snapshot" }
        : node.id === episodeNode.id
          ? { ...node, attempt: 1 }
          : node.id === observationNode.id
            ? { ...node, sourceRevision: `workspace-tree-v1:${"9".repeat(64)}` }
            : node),
    };

    expect(validateExecutionProofGraph(changed).violations.map((item) => item.code))
      .toEqual(expect.arrayContaining(["IDENTITY_MISMATCH", "REVISION_MISMATCH"]));
  });

  it("rejects stale or unknown direct observations", () => {
    const graph = makeValidGraph();
    const target = graph.nodes.find((node) => node.kind === "OBSERVATION")!;
    const stale = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === target.id && node.kind === "OBSERVATION"
        ? { ...node, freshness: "stale" as const }
        : node),
    };

    expect(validateExecutionProofGraph(stale).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "STALE_EVIDENCE" })]));
  });

  it("rejects changed artifact-to-observation bindings and required missing edges", () => {
    const graph = makeValidGraph();
    const artifact = graph.nodes.find((node) => node.kind === "GATE_C_ARTIFACT")!;
    const changedArtifact = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === artifact.id && node.kind === "GATE_C_ARTIFACT"
        ? { ...node, beforeObservationIds: ["unrelated-1", "unrelated-2"] }
        : node),
      edges: graph.edges.slice(1),
    };

    expect(validateExecutionProofGraph(changedArtifact).violations.map((item) => item.code))
      .toEqual(expect.arrayContaining(["OBSERVATION_SET_MISMATCH", "MISSING_REQUIRED_EDGE"]));
  });

  it("rejects dangling, wrong-type, and semantically duplicated edges", () => {
    const graph = makeValidGraph();
    const original = graph.edges[0]!;
    const invalid = {
      ...graph,
      edges: [
        ...graph.edges,
        { ...original, id: "edge:forged-duplicate" },
        makeEdge({
          type: "EXECUTION_HAS_EPISODE",
          from: original.from,
          to: original.to,
        }),
        makeEdge({
          type: "EXECUTION_HAS_EPISODE",
          from: original.from,
          to: "missing-node",
        }),
      ],
    };

    expect(validateExecutionProofGraph(invalid).violations.map((item) => item.code))
      .toEqual(expect.arrayContaining([
        "DUPLICATE_EDGE",
        "DANGLING_EDGE",
        "EDGE_TYPE_MISMATCH",
        "UNEXPECTED_EDGE",
      ]));
  });

  it("rejects Mission placeholders and oversized contracts", () => {
    const graph = makeValidGraph();
    expect(validateExecutionProofGraph({ ...graph, missionId: "synthetic" }).verdict).toBe("FAIL");
    const observation = graph.nodes.find((node) => node.kind === "OBSERVATION")!;
    const withRawObservationValue = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === observation.id
        ? { ...node, value: { pid: 123, port: 8080 } }
        : node),
    };
    expect(validateExecutionProofGraph(withRawObservationValue).violations)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "SCHEMA_INVALID" }),
      ]));
    expect(validateExecutionProofGraph({
      ...graph,
      nodes: Array.from({ length: 65 }, (_, index) => graph.nodes[index % graph.nodes.length]),
    }).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_INVALID" }),
    ]));
  });

  it("enforces byte and edge limits at the schema boundary", () => {
    const graph = makeValidGraph();
    const edgeOverflow = {
      ...graph,
      edges: Array.from({ length: 129 }, (_, index) => ({
        ...graph.edges[index % graph.edges.length]!,
        id: `edge-overflow-${index}`,
      })),
    };
    expect(ExecutionProofGraphSchema.safeParse(edgeOverflow).success).toBe(false);

    const longProjectId = "p".repeat(190);
    const longExecutionId = "e".repeat(190);
    const longOperationId = "o".repeat(190);
    const extraObservations = Array.from({ length: 50 }, (_, index) => {
      const observationId = `${"x".repeat(190)}${String(index).padStart(2, "0")}`;
      return makeNode("OBSERVATION", observationId, {
        observationId,
        observationRole: "after",
        predicate: "runtime.after_state",
        provenance: "DIRECT_OBSERVATION",
        completeness: "complete",
        freshness: "fresh",
        environmentFreshness: "fresh",
        sourceRevision,
        environmentRevision,
        valueHash: "7".repeat(64),
      });
    });
    const byteOverflow = {
      ...graph,
      projectId: longProjectId,
      executionId: longExecutionId,
      operationId: longOperationId,
      graphId: executionProofGraphId(longProjectId, longExecutionId, attempt),
      nodes: [
        ...graph.nodes.map((node) => ({
          ...node,
          projectId: longProjectId,
          executionId: longExecutionId,
          ...(node.kind === "EXECUTION" || node.kind === "ACCEPTANCE" || node.kind === "EVIDENCE_SNAPSHOT"
            ? { operationId: longOperationId }
            : {}),
        })),
        ...extraObservations.map((node) => ({
          ...node,
          projectId: longProjectId,
          executionId: longExecutionId,
        })),
      ],
    };
    const byteOverflowResult = ExecutionProofGraphSchema.safeParse(byteOverflow);
    expect(byteOverflowResult.success).toBe(false);
    if (!byteOverflowResult.success) {
      expect(byteOverflowResult.error.issues.some((issue) => issue.message.includes("contract exceeds"))).toBe(true);
    }
  });
});
