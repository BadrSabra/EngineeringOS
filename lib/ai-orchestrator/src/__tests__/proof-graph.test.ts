import { describe, expect, it } from "vitest";
import {
  hashProofGraph,
  validateProofGraph,
  type ProofGraph,
} from "../agent-state/proof-graph.js";

const parentRevision = "a".repeat(64);
const nextRevision = "b".repeat(64);
const parentWorkspaceRevision = "f".repeat(64);
const scopeHash = "c".repeat(64);
const planRevision = "d".repeat(64);

function makeValidGraph(): ProofGraph {
  const preRules = [
    "AUTHORIZATION_VALID",
    "SCOPE_MATCHED",
    "PRECONDITIONS_SATISFIED",
    "PARENT_REVISION_MATCHED",
    "WORKSPACE_BASE_REVISION_MATCHED",
  ] as const;
  const postRules = [
    "EFFECT_PROVEN",
    "ACCEPTANCE_SUCCEEDED",
    "WORLD_TRANSITION_MATERIALIZED",
  ] as const;

  const preData = preRules.map((rule, index) => ({
    id: `data-pre-${index}`,
    kind: "DATA" as const,
    evidenceRef: `evidence-pre-${index}`,
    contentHash: rule === "SCOPE_MATCHED" ? scopeHash : String(index + 1).repeat(64),
    evidenceKind: rule === "AUTHORIZATION_VALID" ? "AUTHORIZATION"
      : rule === "SCOPE_MATCHED" ? "SCOPE"
        : rule === "PRECONDITIONS_SATISFIED" ? "PRECONDITION"
          : rule === "PARENT_REVISION_MATCHED" ? "PARENT_WORLD_SNAPSHOT" : "PARENT_WORKSPACE_SNAPSHOT",
    revisionDomain: rule === "AUTHORIZATION_VALID" || rule === "SCOPE_MATCHED" ? "PLAN"
      : rule === "WORKSPACE_BASE_REVISION_MATCHED" ? "WORKSPACE_TREE" : "WORLD",
    sourceRevision: rule === "AUTHORIZATION_VALID" || rule === "SCOPE_MATCHED" ? planRevision
      : rule === "WORKSPACE_BASE_REVISION_MATCHED" ? parentWorkspaceRevision : parentRevision,
    provenance: "SERVER_DERIVED" as const,
    freshness: "fresh" as const,
    rule,
  }));
  const postData = postRules.map((rule, index) => ({
    id: `data-post-${index}`,
    kind: "DATA" as const,
    evidenceRef: `evidence-post-${index}`,
    contentHash: String(index + 5).repeat(64),
    evidenceKind: rule === "EFFECT_PROVEN" ? "EFFECT_OBSERVATION"
      : rule === "ACCEPTANCE_SUCCEEDED" ? "EXECUTION_ACCEPTANCE" : "WORLD_TRANSITION",
    revisionDomain: rule === "EFFECT_PROVEN" ? "WORKSPACE_TREE"
      : rule === "ACCEPTANCE_SUCCEEDED" ? "PLAN" : "WORLD",
    sourceRevision: rule === "EFFECT_PROVEN" ? nextRevision
      : rule === "ACCEPTANCE_SUCCEEDED" ? planRevision : "e".repeat(64),
    provenance: (rule === "EFFECT_PROVEN" ? "DIRECT_OBSERVATION" : "SERVER_DERIVED") as "DIRECT_OBSERVATION" | "SERVER_DERIVED",
    freshness: "fresh" as const,
    rule,
  }));

  const controls = [
    ...preRules.map((rule, index) => ({
      id: `control-pre-${index}`,
      kind: "CONTROL" as const,
      ruleId: rule,
      phase: "PRE_EXECUTION" as const,
      outcome: "SATISFIED" as const,
      evidenceRefs: [preData[index]!.evidenceRef],
    })),
    ...postRules.map((rule, index) => ({
      id: `control-post-${index}`,
      kind: "CONTROL" as const,
      ruleId: rule,
      phase: "POST_EXECUTION" as const,
      outcome: "SATISFIED" as const,
      evidenceRefs: [postData[index]!.evidenceRef],
    })),
  ];

  return {
    version: 1,
    graphId: "proof-graph-1",
    projectId: "project-1",
    executionId: "execution-1",
    episodeId: "episode-1",
    attempt: 0,
    missionId: "mission-1",
    goalId: "goal-1",
    planRevision,
    parentWorldRevision: parentRevision,
    resultingWorldRevision: "e".repeat(64),
    parentWorkspaceRevision,
    resultingWorkspaceRevision: nextRevision,
    nodes: [
      ...preData.map(({ rule: _rule, ...node }) => node),
      ...controls,
      {
        id: "execution-1",
        kind: "EXECUTION",
        role: "EXECUTOR",
        actionId: "action-1",
        capabilityId: "apply_changes",
        projectId: "project-1",
        episodeId: "episode-1",
        attempt: 0,
        missionId: "mission-1",
        goalId: "goal-1",
        scopeHash,
        planRevision,
        operationKind: "MUTATION",
      },
      ...postData.map(({ rule: _rule, ...node }) => node),
    ],
    edges: [
      ...preData.flatMap((data, index) => [
        { id: `edge-pre-data-${index}`, type: "DATA_SUPPORTS_CONTROL" as const, from: data.id, to: `control-pre-${index}` },
        { id: `edge-pre-gate-${index}`, type: "CONTROL_GATES_EXECUTION" as const, from: `control-pre-${index}`, to: "execution-1" },
      ]),
      ...postData.flatMap((data, index) => [
        {
          id: `edge-post-binding-${index}`,
          type: (index === 0 ? "EXECUTION_PRODUCES_DATA" : "EXECUTION_BINDS_DATA") as "EXECUTION_PRODUCES_DATA" | "EXECUTION_BINDS_DATA",
          from: "execution-1",
          to: data.id,
        },
        { id: `edge-post-verify-${index}`, type: "EXECUTION_VERIFIED_BY_CONTROL" as const, from: "execution-1", to: `control-post-${index}` },
        { id: `edge-post-evidence-${index}`, type: "DATA_SUPPORTS_CONTROL" as const, from: data.id, to: `control-post-${index}` },
      ]),
    ],
  };
}

describe("Proof Graph Kernel v0", () => {
  it("passes a complete DATA → CONTROL → EXECUTION → DATA proof graph", () => {
    const result = validateProofGraph(makeValidGraph());

    expect(result.verdict).toBe("PASS");
    expect(result.authority).toBe("STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY");
    expect(result.graphHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.violations).toEqual([]);
  });

  it("rejects envelope context that does not match the root Execution", () => {
    const fields = ["projectId", "episodeId", "attempt", "missionId", "goalId"] as const;

    for (const field of fields) {
      const graph = makeValidGraph();
      switch (field) {
        case "projectId": graph.projectId = "tampered-context"; break;
        case "episodeId": graph.episodeId = "tampered-context"; break;
        case "attempt": graph.attempt = 1; break;
        case "missionId": graph.missionId = "tampered-context"; break;
        case "goalId": graph.goalId = "tampered-context"; break;
      }

      const result = validateProofGraph(graph);
      expect(result.verdict, field).toBe("FAIL");
      expect(result.violations.some((item) =>
        item.code === "ROOT_EXECUTION_CONTEXT_MISMATCH" && item.path.includes(field))).toBe(true);
    }
  });

  it("hashes the same logical graph independent of node, edge, and evidence-ref order", () => {
    const graph = makeValidGraph();
    const reversed: ProofGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.kind === "CONTROL"
        ? { ...node, evidenceRefs: [...node.evidenceRefs].reverse() }
        : node).reverse(),
      edges: [...graph.edges].reverse(),
    };

    expect(hashProofGraph(graph)).toBe(hashProofGraph(reversed));
    expect(validateProofGraph(graph).graphHash).toBe(validateProofGraph(reversed).graphHash);
  });

  it("rejects dangling edge endpoints", () => {
    const graph = makeValidGraph();
    graph.edges.push({
      id: "dangling",
      type: "DATA_SUPPORTS_CONTROL",
      from: "missing-data",
      to: "control-pre-0",
    });

    expect(validateProofGraph(graph).violations.some((item) => item.code === "DANGLING_EDGE")).toBe(true);
  });

  it("rejects invalid edge direction instead of silently coercing node types", () => {
    const graph = makeValidGraph();
    graph.edges[0] = {
      id: "wrong-direction",
      type: "DATA_SUPPORTS_CONTROL",
      from: "control-pre-0",
      to: "data-pre-0",
    };

    expect(validateProofGraph(graph).violations.some((item) => item.code === "EDGE_TYPE_MISMATCH")).toBe(true);
  });

  it("rejects a control whose outcome is not satisfied", () => {
    const graph = makeValidGraph();
    const control = graph.nodes.find((node) => node.id === "control-pre-0");
    if (!control || control.kind !== "CONTROL") throw new Error("missing control fixture");
    control.outcome = "UNKNOWN";

    expect(validateProofGraph(graph).violations.some((item) => item.code === "CONTROL_NOT_SATISFIED")).toBe(true);
  });

  it("rejects stale evidence even when a control claims SATISFIED", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-pre-0");
    if (!data || data.kind !== "DATA") throw new Error("missing data fixture");
    data.freshness = "stale";

    expect(validateProofGraph(graph).violations.some((item) => item.code === "CONTROL_EVIDENCE_NOT_FRESH")).toBe(true);
  });

  it("requires authorization, scope, preconditions, and parent-revision controls", () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((node) => node.id !== "control-pre-0" && node.id !== "data-pre-0");
    graph.edges = graph.edges.filter((edge) => edge.from !== "control-pre-0" && edge.to !== "control-pre-0"
      && edge.from !== "data-pre-0" && edge.to !== "data-pre-0");

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "MISSING_REQUIRED_CONTROL" && item.path.includes("AUTHORIZATION_VALID"))).toBe(true);
  });

  it("requires fresh direct after-observations in the workspace-tree revision domain", () => {
    const graph = makeValidGraph();
    const output = graph.nodes.find((node) => node.id === "data-post-0");
    if (!output || output.kind !== "DATA") throw new Error("missing output fixture");
    output.provenance = "SERVER_DERIVED";

    expect(validateProofGraph(graph).violations.some((item) => item.code === "OUTPUT_NOT_DIRECT_OBSERVATION")).toBe(true);

    output.provenance = "DIRECT_OBSERVATION";
    output.evidenceKind = "EXECUTION_ACCEPTANCE";
    expect(validateProofGraph(graph).violations.some((item) => item.code === "OUTPUT_NOT_DIRECT_OBSERVATION")).toBe(true);
  });

  it("requires the Effect observation to bind the exact resulting workspace tree revision", () => {
    const graph = makeValidGraph();
    const effect = graph.nodes.find((node) => node.id === "data-post-0");
    if (!effect || effect.kind !== "DATA") throw new Error("missing effect evidence fixture");
    effect.sourceRevision = parentWorkspaceRevision;

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "OUTPUT_NOT_DIRECT_OBSERVATION")).toBe(true);
    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_REVISION_BINDING_MISMATCH")).toBe(true);
  });

  it("requires the materialized World Transition record to bind the resulting World revision", () => {
    const graph = makeValidGraph();
    const transition = graph.nodes.find((node) => node.id === "data-post-2");
    if (!transition || transition.kind !== "DATA") throw new Error("missing World Transition fixture");
    transition.sourceRevision = parentRevision;

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_REVISION_BINDING_MISMATCH")).toBe(true);
  });

  it("requires the materialized World Transition to advance the parent World Revision", () => {
    const graph = makeValidGraph();
    graph.resultingWorldRevision = graph.parentWorldRevision;
    const result = validateProofGraph(graph);

    expect(result.verdict).toBe("FAIL");
    expect(result.violations.some((item) => item.code === "SCHEMA_INVALID")).toBe(true);
  });

  it("binds the direct effect observation to the exact resulting Workspace Tree Revision", () => {
    const graph = makeValidGraph();
    const effect = graph.nodes.find((node) => node.id === "data-post-0");
    if (!effect || effect.kind !== "DATA") throw new Error("missing direct effect fixture");
    effect.sourceRevision = parentWorkspaceRevision;

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "OUTPUT_NOT_DIRECT_OBSERVATION")).toBe(true);
  });

  it("binds the materialized World Transition record to the exact resulting World Revision", () => {
    const graph = makeValidGraph();
    const transition = graph.nodes.find((node) => node.id === "data-post-2");
    if (!transition || transition.kind !== "DATA") throw new Error("missing World Transition fixture");
    transition.sourceRevision = parentRevision;

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_REVISION_BINDING_MISMATCH")).toBe(true);
  });

  it("requires evidence kind to match the post-execution control", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-post-0");
    if (!data || data.kind !== "DATA") throw new Error("missing effect evidence fixture");
    data.evidenceKind = "EXECUTION_ACCEPTANCE";

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_EVIDENCE_KIND_MISMATCH")).toBe(true);
  });

  it("requires the resulting Workspace Tree Revision to advance the parent snapshot", () => {
    const graph = makeValidGraph();
    graph.resultingWorkspaceRevision = graph.parentWorkspaceRevision;

    const result = validateProofGraph(graph);
    expect(result.verdict).toBe("FAIL");
    expect(result.violations.some((item) => item.code === "SCHEMA_INVALID")).toBe(true);
  });

  it("requires typed evidence revision domains to match the control rule", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-post-0");
    if (!data || data.kind !== "DATA") throw new Error("missing effect evidence fixture");
    data.revisionDomain = "WORLD";

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_EVIDENCE_REVISION_DOMAIN_MISMATCH")).toBe(true);
  });

  it("requires the graph execution identity to bind an actual EXECUTION node", () => {
    const graph = makeValidGraph();
    graph.executionId = "missing-execution";

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "ROOT_EXECUTION_MISSING")).toBe(true);
  });

  it("requires SCOPE_MATCHED evidence to bind the execution scope hash", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-pre-1");
    if (!data || data.kind !== "DATA") throw new Error("missing scope evidence fixture");
    data.contentHash = "e".repeat(64);

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_SCOPE_HASH_MISMATCH")).toBe(true);
  });

  it("requires a server-derived workspace base snapshot in the workspace revision domain", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-pre-4");
    if (!data || data.kind !== "DATA") throw new Error("missing workspace parent evidence fixture");
    data.sourceRevision = nextRevision;

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_REVISION_BINDING_MISMATCH")).toBe(true);
  });

  it("requires the workspace-base revision gate for every execution", () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((node) => node.id !== "control-pre-4" && node.id !== "data-pre-4");
    graph.edges = graph.edges.filter((edge) => edge.from !== "control-pre-4" && edge.to !== "control-pre-4"
      && edge.from !== "data-pre-4" && edge.to !== "data-pre-4");

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "MISSING_REQUIRED_CONTROL"
      && item.path.includes("WORKSPACE_BASE_REVISION_MATCHED"))).toBe(true);
  });

  it("requires the workspace-base snapshot to be server-derived", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-pre-4");
    if (!data || data.kind !== "DATA") throw new Error("missing workspace parent evidence fixture");
    data.provenance = "DIRECT_OBSERVATION";

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_EVIDENCE_PROVENANCE_MISMATCH")).toBe(true);
  });

  it("rejects a parent-revision control backed by another revision", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-pre-3");
    if (!data || data.kind !== "DATA") throw new Error("missing parent evidence fixture");
    data.sourceRevision = nextRevision;

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_REVISION_BINDING_MISMATCH")).toBe(true);
  });

  it("rejects duplicate node identities at the schema boundary", () => {
    const graph = makeValidGraph();
    graph.nodes.push({ ...graph.nodes[0]! });

    const result = validateProofGraph(graph);
    expect(result.verdict).toBe("FAIL");
    expect(result.violations.some((item) => item.code === "SCHEMA_INVALID")).toBe(true);
  });

  it("requires each control's declared evidence refs to match its incoming DATA nodes", () => {
    const graph = makeValidGraph();
    const control = graph.nodes.find((node) => node.id === "control-pre-0");
    if (!control || control.kind !== "CONTROL") throw new Error("missing control fixture");
    control.evidenceRefs = ["evidence-not-connected"];

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "CONTROL_EVIDENCE_MISMATCH")).toBe(true);
  });

  it("rejects DATA with multiple owning executions", () => {
    const graph = makeValidGraph();
    graph.nodes.push({
      id: "execution-2",
      kind: "EXECUTION",
      role: "AGENT",
      actionId: "action-2",
      capabilityId: "apply_changes",
      projectId: "project-1",
      episodeId: "episode-1",
      attempt: 0,
      missionId: "mission-1",
      goalId: "goal-1",
      scopeHash,
      planRevision,
      operationKind: "MUTATION",
    });
    graph.edges.push({
      id: "second-producer",
      type: "EXECUTION_PRODUCES_DATA",
      from: "execution-2",
      to: "data-post-0",
    });

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "MULTIPLE_DATA_OWNERS")).toBe(true);
  });

  it("requires execution-bound proof records to remain server-derived and fresh", () => {
    const graph = makeValidGraph();
    const boundRecord = graph.nodes.find((node) => node.id === "data-post-1");
    if (!boundRecord || boundRecord.kind !== "DATA") throw new Error("missing bound acceptance fixture");
    boundRecord.provenance = "DIRECT_OBSERVATION";

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "BOUND_DATA_PROVENANCE_MISMATCH")).toBe(true);
  });

  it("does not allow a server-derived Acceptance record to masquerade as a produced effect observation", () => {
    const graph = makeValidGraph();
    const boundEdgeIndex = graph.edges.findIndex((edge) => edge.id === "edge-post-binding-1");
    const boundEdge = graph.edges[boundEdgeIndex];
    if (!boundEdge || boundEdge.type !== "EXECUTION_BINDS_DATA") throw new Error("missing bound Acceptance edge");
    graph.edges[boundEdgeIndex] = {
      id: boundEdge.id,
      type: "EXECUTION_PRODUCES_DATA",
      from: boundEdge.from,
      to: boundEdge.to,
    };

    expect(validateProofGraph(graph).violations.some((item) =>
      item.code === "OUTPUT_NOT_DIRECT_OBSERVATION")).toBe(true);
  });

  it("rejects a direct SERVICE → EXECUTOR dependency edge", () => {
    const graph = makeValidGraph();
    const service = {
      id: "service-1",
      kind: "EXECUTION" as const,
      role: "SERVICE" as const,
      actionId: "service-action",
      capabilityId: "service-capability",
      projectId: "project-1",
      episodeId: "episode-1",
      attempt: 0,
      missionId: "mission-1",
      goalId: "goal-1",
      scopeHash,
      planRevision,
      operationKind: "MUTATION" as const,
    };
    graph.nodes.push(service);
    graph.edges.push({
      id: "service-to-executor",
      type: "EXECUTION_DEPENDS_ON",
      from: service.id,
      to: "execution-1",
    });

    expect(validateProofGraph(graph).violations.some((item) => item.code === "DIRECT_SERVICE_EXECUTOR_EDGE")).toBe(true);
  });

  it("rejects execution dependency cycles and reports the violating path", () => {
    const graph = makeValidGraph();
    graph.edges.push(
      { id: "cycle-a", type: "EXECUTION_DEPENDS_ON", from: "execution-1", to: "execution-2" },
      { id: "cycle-b", type: "EXECUTION_DEPENDS_ON", from: "execution-2", to: "execution-1" },
    );
    graph.nodes.push({
      id: "execution-2",
      kind: "EXECUTION",
      role: "AGENT",
      actionId: "action-2",
      capabilityId: "apply_changes",
      projectId: "project-1",
      episodeId: "episode-1",
      attempt: 0,
      missionId: "mission-1",
      goalId: "goal-1",
      scopeHash,
      planRevision,
      operationKind: "MUTATION",
    });

    const result = validateProofGraph(graph);
    const cycle = result.violations.find((item) => item.code === "EXECUTION_CYCLE");
    expect(cycle?.path).toEqual(["execution-1", "execution-2", "execution-1"]);
  });

  it("detects a cycle inferred through execution-bound DATA and reports both causal edges", () => {
    const graph = makeValidGraph();
    const control = graph.nodes.find((node) => node.id === "control-pre-0");
    if (!control || control.kind !== "CONTROL") throw new Error("missing pre-execution control fixture");
    control.evidenceRefs.push("evidence-post-1");
    graph.edges.push({
      id: "inferred-cycle-support",
      type: "DATA_SUPPORTS_CONTROL",
      from: "data-post-1",
      to: control.id,
    });

    const result = validateProofGraph(graph);
    const cycle = result.violations.find((item) => item.code === "EXECUTION_CYCLE");
    expect(cycle?.path).toEqual(["execution-1", "execution-1"]);
    expect(cycle?.edgeIds).toEqual(["inferred-cycle-support", "edge-pre-gate-0"]);
  });

  it("fails closed on model-inferred evidence provenance", () => {
    const graph = makeValidGraph();
    const data = graph.nodes.find((node) => node.id === "data-pre-0");
    if (!data || data.kind !== "DATA") throw new Error("missing data fixture");
    (data as { provenance: string }).provenance = "MODEL_INFERRED";

    expect(validateProofGraph(graph).verdict).toBe("FAIL");
    expect(validateProofGraph(graph).violations.some((item) => item.code === "SCHEMA_INVALID")).toBe(true);
  });
});
