import { z } from "zod";
import {
  boundedContractSchema,
  boundedString,
  canonicalJsonHash,
} from "./contract-utils.js";

export const PROOF_GRAPH_VERSION = 1 as const;
export const PROOF_GRAPH_VALIDATOR_VERSION = "proof-graph-validator.v0" as const;
export const PROOF_GRAPH_MAX_NODES = 256;
export const PROOF_GRAPH_MAX_EDGES = 512;

const digestSchema = boundedString(64).regex(/^[a-f0-9]{64}$/u);

const uniqueStrings = (max: number) => z.array(boundedString(200)).max(max).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "values must be unique" });
  }
});

export const ProofGraphDataNodeSchema = z.object({
  id: boundedString(200),
  kind: z.literal("DATA"),
  evidenceRef: boundedString(256),
  contentHash: digestSchema,
  sourceRevision: digestSchema,
  provenance: z.enum(["DIRECT_OBSERVATION", "SERVER_DERIVED"]),
  freshness: z.enum(["fresh", "stale", "unknown"]),
}).strict();

export const ProofGraphControlRuleSchema = z.enum([
  "AUTHORIZATION_VALID",
  "SCOPE_MATCHED",
  "PRECONDITIONS_SATISFIED",
  "PARENT_REVISION_MATCHED",
  "EFFECT_PROVEN",
  "ACCEPTANCE_SUCCEEDED",
  "WORLD_TRANSITION_MATERIALIZED",
]);

export const ProofGraphControlNodeSchema = z.object({
  id: boundedString(200),
  kind: z.literal("CONTROL"),
  ruleId: ProofGraphControlRuleSchema,
  phase: z.enum(["PRE_EXECUTION", "POST_EXECUTION"]),
  outcome: z.enum(["SATISFIED", "UNSATISFIED", "UNKNOWN"]),
  evidenceRefs: uniqueStrings(64).min(1),
}).strict();

export const ProofGraphExecutionNodeSchema = z.object({
  id: boundedString(200),
  kind: z.literal("EXECUTION"),
  role: z.enum(["AGENT", "SERVICE", "EXECUTOR"]),
  actionId: boundedString(200),
  capabilityId: boundedString(200),
  scopeHash: digestSchema,
  planRevision: digestSchema,
  operationKind: z.literal("MUTATION"),
}).strict();

export const ProofGraphNodeSchema = z.discriminatedUnion("kind", [
  ProofGraphDataNodeSchema,
  ProofGraphControlNodeSchema,
  ProofGraphExecutionNodeSchema,
]);

const ProofGraphEdgeBaseSchema = z.object({
  id: boundedString(200),
  from: boundedString(200),
  to: boundedString(200),
});

export const ProofGraphEdgeSchema = z.discriminatedUnion("type", [
  ProofGraphEdgeBaseSchema.extend({ type: z.literal("DATA_SUPPORTS_CONTROL") }),
  ProofGraphEdgeBaseSchema.extend({ type: z.literal("CONTROL_GATES_EXECUTION") }),
  ProofGraphEdgeBaseSchema.extend({ type: z.literal("EXECUTION_PRODUCES_DATA") }),
  ProofGraphEdgeBaseSchema.extend({ type: z.literal("EXECUTION_VERIFIED_BY_CONTROL") }),
  // Direction is prerequisite -> dependent. This edge participates in cycle checks.
  ProofGraphEdgeBaseSchema.extend({ type: z.literal("EXECUTION_DEPENDS_ON") }),
]);

export const ProofGraphSchema = boundedContractSchema(z.object({
  version: z.literal(PROOF_GRAPH_VERSION),
  graphId: boundedString(200),
  projectId: boundedString(200),
  executionId: boundedString(200),
  episodeId: boundedString(200),
  attempt: z.number().int().nonnegative(),
  missionId: boundedString(200),
  goalId: boundedString(200),
  planRevision: digestSchema,
  parentWorldRevision: digestSchema,
  nodes: z.array(ProofGraphNodeSchema).max(PROOF_GRAPH_MAX_NODES),
  edges: z.array(ProofGraphEdgeSchema).max(PROOF_GRAPH_MAX_EDGES),
}).strict(), 32 * 1024);
export type ProofGraph = z.infer<typeof ProofGraphSchema>;
export type ProofGraphNode = z.infer<typeof ProofGraphNodeSchema>;
export type ProofGraphDataNode = z.infer<typeof ProofGraphDataNodeSchema>;
export type ProofGraphControlNode = z.infer<typeof ProofGraphControlNodeSchema>;
export type ProofGraphExecutionNode = z.infer<typeof ProofGraphExecutionNodeSchema>;
export type ProofGraphEdge = z.infer<typeof ProofGraphEdgeSchema>;
export type ProofGraphControlRule = z.infer<typeof ProofGraphControlRuleSchema>;

export const PROOF_GRAPH_REQUIRED_PRE_RULES = [
  "AUTHORIZATION_VALID",
  "SCOPE_MATCHED",
  "PRECONDITIONS_SATISFIED",
  "PARENT_REVISION_MATCHED",
] as const satisfies readonly ProofGraphControlRule[];

export const PROOF_GRAPH_REQUIRED_POST_RULES = [
  "EFFECT_PROVEN",
  "ACCEPTANCE_SUCCEEDED",
  "WORLD_TRANSITION_MATERIALIZED",
] as const satisfies readonly ProofGraphControlRule[];

export type ProofGraphViolationCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_EDGE"
  | "DANGLING_EDGE"
  | "EDGE_TYPE_MISMATCH"
  | "CONTROL_PHASE_MISMATCH"
  | "CONTROL_NOT_SATISFIED"
  | "CONTROL_EVIDENCE_MISMATCH"
  | "CONTROL_EVIDENCE_NOT_FRESH"
  | "MISSING_REQUIRED_CONTROL"
  | "DUPLICATE_CONTROL_RULE"
  | "EXECUTION_HAS_NO_OUTPUT"
  | "OUTPUT_NOT_DIRECT_OBSERVATION"
  | "OUTPUT_REVISION_UNCHANGED"
  | "POST_CONTROL_NOT_BOUND_TO_EXECUTION_OUTPUT"
  | "ORPHAN_NODE"
  | "DIRECT_SERVICE_EXECUTOR_EDGE"
  | "EXECUTION_CYCLE"
  | "EXECUTION_PLAN_REVISION_MISMATCH";

export type ProofGraphViolation = {
  code: ProofGraphViolationCode;
  path: string[];
  edgeIds: string[];
};

export type ProofGraphValidationResult = {
  validatorVersion: typeof PROOF_GRAPH_VALIDATOR_VERSION;
  authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY";
  verdict: "PASS" | "FAIL";
  graphHash: string | null;
  violations: ProofGraphViolation[];
};

const PRE_RULES = new Set<string>(PROOF_GRAPH_REQUIRED_PRE_RULES);
const POST_RULES = new Set<string>(PROOF_GRAPH_REQUIRED_POST_RULES);

function canonicalGraph(graph: ProofGraph): ProofGraph {
  return {
    ...graph,
    nodes: [...graph.nodes]
      .map((node) => node.kind === "CONTROL"
        ? { ...node, evidenceRefs: [...node.evidenceRefs].sort() }
        : node)
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...graph.edges].sort((left, right) =>
      left.type.localeCompare(right.type)
      || left.from.localeCompare(right.from)
      || left.to.localeCompare(right.to)
      || left.id.localeCompare(right.id)),
  };
}

export function hashProofGraph(graph: ProofGraph): string {
  const canonical = canonicalGraph(ProofGraphSchema.parse(graph));
  return canonicalJsonHash(canonical as Parameters<typeof canonicalJsonHash>[0]);
}

function findExecutionCycle(
  adjacency: ReadonlyMap<string, readonly { to: string; edgeId: string }[]>,
  executionIds: readonly string[],
): { path: string[]; edgeIds: string[] } | undefined {
  const visited = new Set<string>();
  const activeIndex = new Map<string, number>();
  const nodeStack: string[] = [];
  const edgeStack: string[] = [];

  const visit = (nodeId: string): { path: string[]; edgeIds: string[] } | undefined => {
    activeIndex.set(nodeId, nodeStack.length);
    nodeStack.push(nodeId);
    const outgoing = [...(adjacency.get(nodeId) ?? [])]
      .sort((left, right) => left.to.localeCompare(right.to) || left.edgeId.localeCompare(right.edgeId));

    for (const edge of outgoing) {
      const cycleStart = activeIndex.get(edge.to);
      if (cycleStart !== undefined) {
        return {
          path: [...nodeStack.slice(cycleStart), edge.to],
          edgeIds: [...edgeStack.slice(cycleStart), edge.edgeId],
        };
      }
      if (!visited.has(edge.to)) {
        edgeStack.push(edge.edgeId);
        const cycle = visit(edge.to);
        if (cycle) return cycle;
        edgeStack.pop();
      }
    }

    nodeStack.pop();
    activeIndex.delete(nodeId);
    visited.add(nodeId);
    return undefined;
  };

  for (const executionId of [...executionIds].sort()) {
    if (visited.has(executionId)) continue;
    const cycle = visit(executionId);
    if (cycle) return cycle;
  }
  return undefined;
}

function sortViolations(violations: ProofGraphViolation[]): ProofGraphViolation[] {
  return violations.sort((left, right) =>
    left.code.localeCompare(right.code)
    || left.path.join("\u0000").localeCompare(right.path.join("\u0000"))
    || left.edgeIds.join("\u0000").localeCompare(right.edgeIds.join("\u0000")));
}

/**
 * Validates the structure of a server-projected proof graph.
 *
 * This function is deliberately pure. It does not authenticate evidence,
 * read a database, authorize an action, execute a capability, or produce
 * Canonical Acceptance. PASS means only that the typed graph satisfies the
 * v0 structural invariants.
 */
export function validateProofGraph(input: unknown): ProofGraphValidationResult {
  const parsed = ProofGraphSchema.safeParse(input);
  if (!parsed.success) {
    const violations = parsed.error.issues.map((issue) => ({
      code: "SCHEMA_INVALID" as const,
      path: issue.path.map((part) => String(part)),
      edgeIds: [],
    }));
    return {
      validatorVersion: PROOF_GRAPH_VALIDATOR_VERSION,
      authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY",
      verdict: "FAIL",
      graphHash: null,
      violations: sortViolations(violations),
    };
  }

  const graph = parsed.data;
  const graphHash = hashProofGraph(graph);
  const violations: ProofGraphViolation[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesByType = new Map<ProofGraphEdge["type"], ProofGraphEdge[]>();
  for (const type of [
    "DATA_SUPPORTS_CONTROL",
    "CONTROL_GATES_EXECUTION",
    "EXECUTION_PRODUCES_DATA",
    "EXECUTION_VERIFIED_BY_CONTROL",
    "EXECUTION_DEPENDS_ON",
  ] as const) edgesByType.set(type, []);

  const addViolation = (
    code: ProofGraphViolationCode,
    path: string[],
    edgeIds: string[] = [],
  ) => violations.push({ code, path, edgeIds });

  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    const edgeKey = `${edge.type}\u0000${edge.from}\u0000${edge.to}`;
    if (seenEdges.has(edgeKey)) addViolation("DUPLICATE_EDGE", [edge.from, edge.to], [edge.id]);
    seenEdges.add(edgeKey);

    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) {
      addViolation("DANGLING_EDGE", [edge.from, edge.to], [edge.id]);
      continue;
    }

    edgesByType.get(edge.type)!.push(edge);
    const valid =
      (edge.type === "DATA_SUPPORTS_CONTROL" && from.kind === "DATA" && to.kind === "CONTROL")
      || (edge.type === "CONTROL_GATES_EXECUTION" && from.kind === "CONTROL" && to.kind === "EXECUTION")
      || (edge.type === "EXECUTION_PRODUCES_DATA" && from.kind === "EXECUTION" && to.kind === "DATA")
      || (edge.type === "EXECUTION_VERIFIED_BY_CONTROL" && from.kind === "EXECUTION" && to.kind === "CONTROL")
      || (edge.type === "EXECUTION_DEPENDS_ON" && from.kind === "EXECUTION" && to.kind === "EXECUTION");
    if (!valid) addViolation("EDGE_TYPE_MISMATCH", [edge.from, edge.to], [edge.id]);

    if (edge.type === "EXECUTION_DEPENDS_ON" && from.kind === "EXECUTION" && to.kind === "EXECUTION"
      && from.role === "SERVICE" && to.role === "EXECUTOR") {
      addViolation("DIRECT_SERVICE_EXECUTOR_EDGE", [from.id, to.id], [edge.id]);
    }
  }

  const supportEdges = edgesByType.get("DATA_SUPPORTS_CONTROL")!;
  const gateEdges = edgesByType.get("CONTROL_GATES_EXECUTION")!;
  const produceEdges = edgesByType.get("EXECUTION_PRODUCES_DATA")!;
  const verifyEdges = edgesByType.get("EXECUTION_VERIFIED_BY_CONTROL")!;
  const dependencyEdges = edgesByType.get("EXECUTION_DEPENDS_ON")!;

  const supportByControl = new Map<string, ProofGraphDataNode[]>();
  const gatesByExecution = new Map<string, ProofGraphControlNode[]>();
  const outputsByExecution = new Map<string, ProofGraphDataNode[]>();
  const verificationsByExecution = new Map<string, ProofGraphControlNode[]>();
  const producersByData = new Map<string, string[]>();

  for (const edge of supportEdges) {
    const data = nodesById.get(edge.from);
    const control = nodesById.get(edge.to);
    if (data?.kind !== "DATA" || control?.kind !== "CONTROL") continue;
    supportByControl.set(control.id, [...(supportByControl.get(control.id) ?? []), data]);
  }
  for (const edge of gateEdges) {
    const control = nodesById.get(edge.from);
    const execution = nodesById.get(edge.to);
    if (control?.kind !== "CONTROL" || execution?.kind !== "EXECUTION") continue;
    gatesByExecution.set(execution.id, [...(gatesByExecution.get(execution.id) ?? []), control]);
  }
  for (const edge of produceEdges) {
    const execution = nodesById.get(edge.from);
    const data = nodesById.get(edge.to);
    if (execution?.kind !== "EXECUTION" || data?.kind !== "DATA") continue;
    outputsByExecution.set(execution.id, [...(outputsByExecution.get(execution.id) ?? []), data]);
    producersByData.set(data.id, [...(producersByData.get(data.id) ?? []), execution.id]);
  }
  for (const edge of verifyEdges) {
    const execution = nodesById.get(edge.from);
    const control = nodesById.get(edge.to);
    if (execution?.kind !== "EXECUTION" || control?.kind !== "CONTROL") continue;
    verificationsByExecution.set(execution.id, [...(verificationsByExecution.get(execution.id) ?? []), control]);
  }

  for (const control of graph.nodes.filter((node): node is ProofGraphControlNode => node.kind === "CONTROL")) {
    const evidenceNodes = supportByControl.get(control.id) ?? [];
    const actualEvidence = new Set(evidenceNodes.map((node) => node.evidenceRef));
    const declaredEvidence = new Set(control.evidenceRefs);
    const sameEvidence = actualEvidence.size === declaredEvidence.size
      && [...actualEvidence].every((ref) => declaredEvidence.has(ref));

    if (evidenceNodes.length === 0 || !sameEvidence) {
      addViolation("CONTROL_EVIDENCE_MISMATCH", [control.id, ...control.evidenceRefs]);
    }
    if (evidenceNodes.some((node) => node.freshness !== "fresh")) {
      addViolation("CONTROL_EVIDENCE_NOT_FRESH", [control.id, ...evidenceNodes.filter((node) => node.freshness !== "fresh").map((node) => node.id)]);
    }
    if (control.outcome !== "SATISFIED") {
      addViolation("CONTROL_NOT_SATISFIED", [control.id, ...evidenceNodes.map((node) => node.id)]);
    }

    const gates = gateEdges.filter((edge) => edge.from === control.id);
    const verifies = verifyEdges.filter((edge) => edge.to === control.id);
    if (control.phase === "PRE_EXECUTION") {
      if (!PRE_RULES.has(control.ruleId) || gates.length === 0 || verifies.length > 0) {
        addViolation("CONTROL_PHASE_MISMATCH", [control.id], [...gates, ...verifies].map((edge) => edge.id));
      }
    } else if (!POST_RULES.has(control.ruleId) || verifies.length === 0 || gates.length > 0) {
      addViolation("CONTROL_PHASE_MISMATCH", [control.id], [...gates, ...verifies].map((edge) => edge.id));
    }

    if (control.phase === "POST_EXECUTION") {
      for (const edge of verifies) {
        const executionOutputs = new Set((outputsByExecution.get(edge.from) ?? []).map((node) => node.id));
        if (evidenceNodes.some((node) => !executionOutputs.has(node.id))) {
          addViolation("POST_CONTROL_NOT_BOUND_TO_EXECUTION_OUTPUT", [edge.from, control.id, ...evidenceNodes.map((node) => node.id)], [edge.id]);
        }
      }
    }
  }

  const executionNodes = graph.nodes.filter((node): node is ProofGraphExecutionNode => node.kind === "EXECUTION");
  for (const execution of executionNodes) {
    if (execution.planRevision !== graph.planRevision) {
      addViolation("EXECUTION_PLAN_REVISION_MISMATCH", [execution.id]);
    }

    const gates = gatesByExecution.get(execution.id) ?? [];
    const gateRules = gates.map((control) => control.ruleId);
    for (const rule of PROOF_GRAPH_REQUIRED_PRE_RULES) {
      const count = gateRules.filter((candidate) => candidate === rule).length;
      if (count === 0) addViolation("MISSING_REQUIRED_CONTROL", [execution.id, rule]);
      if (count > 1) addViolation("DUPLICATE_CONTROL_RULE", [execution.id, rule]);
    }

    const outputs = outputsByExecution.get(execution.id) ?? [];
    if (outputs.length === 0) {
      addViolation("EXECUTION_HAS_NO_OUTPUT", [execution.id]);
    } else {
      if (outputs.some((node) => node.provenance !== "DIRECT_OBSERVATION" || node.freshness !== "fresh")) {
        addViolation("OUTPUT_NOT_DIRECT_OBSERVATION", [execution.id, ...outputs.filter(
          (node) => node.provenance !== "DIRECT_OBSERVATION" || node.freshness !== "fresh",
        ).map((node) => node.id)]);
      }
      if (!outputs.some((node) => node.sourceRevision !== graph.parentWorldRevision)) {
        addViolation("OUTPUT_REVISION_UNCHANGED", [execution.id, ...outputs.map((node) => node.id)]);
      }
    }

    const postControls = verificationsByExecution.get(execution.id) ?? [];
    const postRules = postControls.map((control) => control.ruleId);
    for (const rule of PROOF_GRAPH_REQUIRED_POST_RULES) {
      const count = postRules.filter((candidate) => candidate === rule).length;
      if (count === 0) addViolation("MISSING_REQUIRED_CONTROL", [execution.id, rule]);
      if (count > 1) addViolation("DUPLICATE_CONTROL_RULE", [execution.id, rule]);
    }
  }

  for (const node of graph.nodes) {
    const connected = graph.edges.some((edge) => edge.from === node.id || edge.to === node.id);
    if (!connected) addViolation("ORPHAN_NODE", [node.id]);
  }

  // Build an execution-level graph from explicit dependency edges and from
  // produced DATA that supports a later PRE_EXECUTION control.
  const executionAdjacency = new Map<string, { to: string; edgeId: string }[]>();
  for (const execution of executionNodes) executionAdjacency.set(execution.id, []);
  for (const edge of dependencyEdges) {
    if (nodesById.get(edge.from)?.kind === "EXECUTION" && nodesById.get(edge.to)?.kind === "EXECUTION") {
      executionAdjacency.get(edge.from)!.push({ to: edge.to, edgeId: edge.id });
    }
  }
  const producerByData = new Map<string, string>();
  for (const edge of produceEdges) {
    if (nodesById.get(edge.from)?.kind === "EXECUTION" && nodesById.get(edge.to)?.kind === "DATA") {
      producerByData.set(edge.to, edge.from);
    }
  }
  for (const support of supportEdges) {
    const dataNode = nodesById.get(support.from);
    const controlNode = nodesById.get(support.to);
    if (dataNode?.kind !== "DATA" || controlNode?.kind !== "CONTROL" || controlNode.phase !== "PRE_EXECUTION") continue;
    const producer = producerByData.get(dataNode.id);
    if (!producer) continue;
    for (const gate of gateEdges.filter((edge) => edge.from === controlNode.id)) {
      executionAdjacency.get(producer)?.push({ to: gate.to, edgeId: support.id });
    }
  }
  const cycle = findExecutionCycle(executionAdjacency, executionNodes.map((node) => node.id));
  if (cycle) addViolation("EXECUTION_CYCLE", cycle.path, cycle.edgeIds);

  return {
    validatorVersion: PROOF_GRAPH_VALIDATOR_VERSION,
    authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY",
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    graphHash,
    violations: sortViolations(violations),
  };
}
