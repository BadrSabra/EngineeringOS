import { describe, expect, it } from "vitest";
import {
  hashProofGraph,
  validateProofGraph,
  type ProofGraph,
} from "../agent-state/proof-graph.js";

const parentRevision = "a".repeat(64);
const nextRevision = "b".repeat(64);
const scopeHash = "c".repeat(64);
const planRevision = "d".repeat(64);

function makeValidGraph(): ProofGraph {
  const preRules = [
    "AUTHORIZATION_VALID",
    "SCOPE_MATCHED",
    "PRECONDITIONS_SATISFIED",
    "PARENT_REVISION_MATCHED",
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
    contentHash: String(index + 1).repeat(64),
    sourceRevision: parentRevision,
    provenance: "SERVER_DERIVED" as const,
    freshness: "fresh" as const,
    rule,
  }));
  const postData = postRules.map((rule, index) => ({
    id: `data-post-${index}`,
    kind: "DATA" as const,
    evidenceRef: `evidence-post-${index}`,
    contentHash: String(index + 5).repeat(64),
    sourceRevision: nextRevision,
    provenance: "DIRECT_OBSERVATION" as const,
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
    nodes: [
      ...preData.map(({ rule: _rule, ...node }) => node),
      ...controls,
      {
        id: "execution-1",
        kind: "EXECUTION",
        role: "EXECUTOR",
        actionId: "action-1",
        capabilityId: "apply_changes",
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
        { id: `edge-post-output-${index}`, type: "EXECUTION_PRODUCES_DATA" as const, from: "execution-1", to: data.id },
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

  it("hashes the same logical graph independent of node, edge, and evidence-ref order", () => {
    const graph = makeValidGraph();
    const reversed: ProofGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.kind === "CONTROL"
        ? { ...node, evidenceRefs: [...node.evidenceRefs].reverse() }
        : node).reverse(),
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

  it("requires fresh direct after-observations that advance beyond the parent revision", () => {
    const graph = makeValidGraph();
    const output = graph.nodes.find((node) => node.id === "data-post-0");
    if (!output || output.kind !== "DATA") throw new Error("missing output fixture");
    output.provenance = "SERVER_DERIVED";

    expect(validateProofGraph(graph).violations.some((item) => item.code === "OUTPUT_NOT_DIRECT_OBSERVATION")).toBe(true);

    output.provenance = "DIRECT_OBSERVATION";
    output.sourceRevision = parentRevision;
    graph.nodes.filter((node) => node.kind === "DATA" && node.id.startsWith("data-post-"))
      .forEach((node) => { if (node.kind === "DATA") node.sourceRevision = parentRevision; });
    expect(validateProofGraph(graph).violations.some((item) => item.code === "OUTPUT_REVISION_UNCHANGED")).toBe(true);
  });

  it("rejects a direct SERVICE → EXECUTOR dependency edge", () => {
    const graph = makeValidGraph();
    const service = {
      id: "service-1",
      kind: "EXECUTION" as const,
      role: "SERVICE" as const,
      actionId: "service-action",
      capabilityId: "service-capability",
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
      scopeHash,
      planRevision,
      operationKind: "MUTATION",
    });

    const result = validateProofGraph(graph);
    const cycle = result.violations.find((item) => item.code === "EXECUTION_CYCLE");
    expect(cycle?.path).toEqual(["execution-1", "execution-2", "execution-1"]);
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
