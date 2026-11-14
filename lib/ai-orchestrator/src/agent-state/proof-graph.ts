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

const uniqueStrings = (max: number) => z.array(boundedString(200)).min(1).max(max).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "values must be unique" });
  }
});

export const ProofGraphDataNodeSchema = z.object({
  id: boundedString(200),
  kind: z.literal("DATA"),
  evidenceRef: boundedString(256),
  contentHash: digestSchema,
  evidenceKind: z.enum([
    "AUTHORIZATION",
    "SCOPE",
    "PRECONDITION",
    "PARENT_WORLD_SNAPSHOT",
    "PARENT_WORKSPACE_SNAPSHOT",
    "EFFECT_OBSERVATION",
    "EXECUTION_ACCEPTANCE",
    "WORLD_TRANSITION",
  ]),
  revisionDomain: z.enum(["WORLD", "WORKSPACE_TREE", "ENVIRONMENT", "PLAN"]),
  sourceRevision: digestSchema,
  provenance: z.enum(["DIRECT_OBSERVATION", "SERVER_DERIVED"]),
  freshness: z.enum(["fresh", "stale", "unknown"]),
}).strict();

export const ProofGraphControlRuleSchema = z.enum([
  "AUTHORIZATION_VALID",
  "SCOPE_MATCHED",
  "PRECONDITIONS_SATISFIED",
  "PARENT_REVISION_MATCHED",
  "WORKSPACE_BASE_REVISION_MATCHED",
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
  evidenceRefs: uniqueStrings(64),
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
  // A produced DATA node is an effect observation. A bound DATA node is a
  // server-owned record (for example Acceptance or a materialized transition)
  // associated with this execution, not an effect observation.
  ProofGraphEdgeBaseSchema.extend({ type: z.literal("EXECUTION_PRODUCES_DATA") }),
  ProofGraphEdgeBaseSchema.extend({ type: z.literal("EXECUTION_BINDS_DATA") }),
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
  resultingWorldRevision: digestSchema,
  parentWorkspaceRevision: digestSchema,
  resultingWorkspaceRevision: digestSchema,
  nodes: z.array(ProofGraphNodeSchema).min(1).max(PROOF_GRAPH_MAX_NODES),
  edges: z.array(ProofGraphEdgeSchema).min(1).max(PROOF_GRAPH_MAX_EDGES),
}).strict().superRefine((graph, ctx) => {
  const nodeIds = new Set<string>();
  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "id"], message: "node id must be unique" });
    }
    nodeIds.add(node.id);
  });
  const edgeIds = new Set<string>();
  graph.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", index, "id"], message: "edge id must be unique" });
    }
    edgeIds.add(edge.id);
  });
  if (graph.resultingWorldRevision === graph.parentWorldRevision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resultingWorldRevision"], message: "a materialized mutation must advance the World Revision" });
  }
  if (graph.resultingWorkspaceRevision === graph.parentWorkspaceRevision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resultingWorkspaceRevision"], message: "an Apply Changes mutation must advance the workspace tree revision" });
  }
}), 32 * 1024);
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
  "WORKSPACE_BASE_REVISION_MATCHED",
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
  | "POST_CONTROL_NOT_BOUND_TO_EXECUTION_DATA"
  | "ORPHAN_NODE"
  | "DIRECT_SERVICE_EXECUTOR_EDGE"
  | "EXECUTION_CYCLE"
  | "EXECUTION_PLAN_REVISION_MISMATCH"
  | "CONTROL_EVIDENCE_PROVENANCE_MISMATCH"
  | "NO_EXECUTION_NODE"
  | "MULTIPLE_DATA_OWNERS"
  | "ROOT_EXECUTION_MISSING"
  | "CONTROL_SCOPE_HASH_MISMATCH"
  | "BOUND_DATA_PROVENANCE_MISMATCH"
  | "CONTROL_EVIDENCE_KIND_MISMATCH"
  | "CONTROL_EVIDENCE_REVISION_DOMAIN_MISMATCH"
  | "CONTROL_REVISION_BINDING_MISMATCH";

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

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index++) {
    const result = compareString(left[index]!, right[index]!);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

function canonicalGraph(graph: ProofGraph): ProofGraph {
  return {
    ...graph,
    nodes: [...graph.nodes]
      .map((node) => node.kind === "CONTROL"
        ? { ...node, evidenceRefs: [...node.evidenceRefs].sort() }
        : node)
      .sort((left, right) => compareString(left.id, right.id)),
    edges: [...graph.edges].sort((left, right) =>
      compareString(left.type, right.type)
      || compareString(left.from, right.from)
      || compareString(left.to, right.to)
      || compareString(left.id, right.id)),
  };
}

export function hashProofGraph(graph: ProofGraph): string {
  const canonical = canonicalGraph(ProofGraphSchema.parse(graph));
  return canonicalJsonHash(canonical as Parameters<typeof canonicalJsonHash>[0]);
}

function findExecutionCycle(
  adjacency: ReadonlyMap<string, readonly { to: string; edgeIds: string[] }[]>,
  executionIds: readonly string[],
): { path: string[]; edgeIds: string[] } | undefined {
  const visited = new Set<string>();
  const activeIndex = new Map<string, number>();
  const nodeStack: string[] = [];
  const edgeStack: string[][] = [];

  const visit = (nodeId: string): { path: string[]; edgeIds: string[] } | undefined => {
    activeIndex.set(nodeId, nodeStack.length);
    nodeStack.push(nodeId);
    const outgoing = [...(adjacency.get(nodeId) ?? [])]
      .sort((left, right) => compareString(left.to, right.to)
        || compareStringArrays(left.edgeIds, right.edgeIds));

    for (const edge of outgoing) {
      const cycleStart = activeIndex.get(edge.to);
      if (cycleStart !== undefined) {
        return {
          path: [...nodeStack.slice(cycleStart), edge.to],
          edgeIds: [...edgeStack.slice(cycleStart).flat(), ...edge.edgeIds],
        };
      }
      if (!visited.has(edge.to)) {
        edgeStack.push(edge.edgeIds);
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
    compareString(left.code, right.code)
    || compareString(left.path.join("\u0000"), right.path.join("\u0000"))
    || compareString(left.edgeIds.join("\u0000"), right.edgeIds.join("\u0000")));
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
    "EXECUTION_BINDS_DATA",
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
      || (edge.type === "EXECUTION_BINDS_DATA" && from.kind === "EXECUTION" && to.kind === "DATA")
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
  const boundDataByExecution = new Map<string, ProofGraphDataNode[]>();
  const verificationsByExecution = new Map<string, ProofGraphControlNode[]>();
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
  }
  for (const edge of edgesByType.get("EXECUTION_BINDS_DATA")!) {
    const execution = nodesById.get(edge.from);
    const data = nodesById.get(edge.to);
    if (execution?.kind !== "EXECUTION" || data?.kind !== "DATA") continue;
    boundDataByExecution.set(execution.id, [...(boundDataByExecution.get(execution.id) ?? []), data]);
    if (data.provenance !== "SERVER_DERIVED" || data.freshness !== "fresh") {
      addViolation("BOUND_DATA_PROVENANCE_MISMATCH", [execution.id, data.id], [edge.id]);
    }
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

    if (evidenceNodes.length === 0 || actualEvidence.size !== evidenceNodes.length || !sameEvidence) {
      addViolation("CONTROL_EVIDENCE_MISMATCH", [control.id, ...control.evidenceRefs]);
    }
    if (evidenceNodes.some((node) => node.freshness !== "fresh")) {
      addViolation("CONTROL_EVIDENCE_NOT_FRESH", [control.id, ...evidenceNodes.filter((node) => node.freshness !== "fresh").map((node) => node.id)]);
    }
    if (control.outcome !== "SATISFIED") {
      addViolation("CONTROL_NOT_SATISFIED", [control.id, ...evidenceNodes.map((node) => node.id)]);
    }

    const expectedEvidence: {
      kind: ProofGraphDataNode["evidenceKind"];
      revisionDomain: ProofGraphDataNode["revisionDomain"];
      provenance?: ProofGraphDataNode["provenance"];
    } = {
      AUTHORIZATION_VALID: { kind: "AUTHORIZATION", revisionDomain: "PLAN", provenance: "SERVER_DERIVED" },
      SCOPE_MATCHED: { kind: "SCOPE", revisionDomain: "PLAN", provenance: "SERVER_DERIVED" },
      PRECONDITIONS_SATISFIED: { kind: "PRECONDITION", revisionDomain: "WORLD" },
      PARENT_REVISION_MATCHED: { kind: "PARENT_WORLD_SNAPSHOT", revisionDomain: "WORLD", provenance: "SERVER_DERIVED" },
      WORKSPACE_BASE_REVISION_MATCHED: { kind: "PARENT_WORKSPACE_SNAPSHOT", revisionDomain: "WORKSPACE_TREE", provenance: "SERVER_DERIVED" },
      EFFECT_PROVEN: { kind: "EFFECT_OBSERVATION", revisionDomain: "WORKSPACE_TREE", provenance: "DIRECT_OBSERVATION" },
      ACCEPTANCE_SUCCEEDED: { kind: "EXECUTION_ACCEPTANCE", revisionDomain: "PLAN", provenance: "SERVER_DERIVED" },
      WORLD_TRANSITION_MATERIALIZED: { kind: "WORLD_TRANSITION", revisionDomain: "WORLD", provenance: "SERVER_DERIVED" },
    }[control.ruleId];
    if (evidenceNodes.some((node) => node.evidenceKind !== expectedEvidence.kind)) {
      addViolation("CONTROL_EVIDENCE_KIND_MISMATCH", [control.id, ...evidenceNodes.map((node) => node.id)]);
    }
    if (evidenceNodes.some((node) => node.revisionDomain !== expectedEvidence.revisionDomain)) {
      addViolation("CONTROL_EVIDENCE_REVISION_DOMAIN_MISMATCH", [control.id, ...evidenceNodes.map((node) => node.id)]);
    }
    const expectedProvenance = expectedEvidence.provenance;
    if (expectedProvenance && evidenceNodes.some((node) => node.provenance !== expectedProvenance)) {
      addViolation("CONTROL_EVIDENCE_PROVENANCE_MISMATCH", [control.id, ...evidenceNodes.map((node) => node.id)]);
    }
    const expectedRevision = control.ruleId === "AUTHORIZATION_VALID" || control.ruleId === "SCOPE_MATCHED"
      || control.ruleId === "ACCEPTANCE_SUCCEEDED"
      ? graph.planRevision
      : control.ruleId === "PRECONDITIONS_SATISFIED" || control.ruleId === "PARENT_REVISION_MATCHED"
        ? graph.parentWorldRevision
        : control.ruleId === "WORKSPACE_BASE_REVISION_MATCHED"
          ? graph.parentWorkspaceRevision
          : control.ruleId === "EFFECT_PROVEN"
            ? graph.resultingWorkspaceRevision
            : graph.resultingWorldRevision;
    if (evidenceNodes.some((node) => node.sourceRevision !== expectedRevision)) {
      addViolation("CONTROL_REVISION_BINDING_MISMATCH", [control.id, ...evidenceNodes.map((node) => node.id)]);
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
        const boundEvidence = control.ruleId === "EFFECT_PROVEN"
          ? outputsByExecution.get(edge.from) ?? []
          : boundDataByExecution.get(edge.from) ?? [];
        const executionEvidence = new Set(boundEvidence.map((node) => node.id));
        if (evidenceNodes.some((node) => !executionEvidence.has(node.id))) {
          addViolation("POST_CONTROL_NOT_BOUND_TO_EXECUTION_DATA", [edge.from, control.id, ...evidenceNodes.map((node) => node.id)], [edge.id]);
        }
      }
    }
  }

  const executionNodes = graph.nodes.filter((node): node is ProofGraphExecutionNode => node.kind === "EXECUTION");
  if (executionNodes.length === 0) addViolation("NO_EXECUTION_NODE", [graph.graphId]);
  if (!executionNodes.some((execution) => execution.id === graph.executionId)) {
    addViolation("ROOT_EXECUTION_MISSING", [graph.graphId, graph.executionId]);
  }
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
    for (const control of gates.filter((candidate) => candidate.ruleId === "SCOPE_MATCHED")) {
      const evidenceNodes = supportByControl.get(control.id) ?? [];
      if (evidenceNodes.length !== 1 || evidenceNodes[0]?.contentHash !== execution.scopeHash) {
        addViolation("CONTROL_SCOPE_HASH_MISMATCH", [execution.id, control.id, ...evidenceNodes.map((node) => node.id)]);
      }
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
      if (outputs.some((node) => node.evidenceKind !== "EFFECT_OBSERVATION"
        || node.revisionDomain !== "WORKSPACE_TREE"
        || node.sourceRevision !== graph.resultingWorkspaceRevision)) {
        addViolation("OUTPUT_NOT_DIRECT_OBSERVATION", [execution.id, ...outputs.map((node) => node.id)]);
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
  // output/bound DATA that supports a later PRE_EXECUTION control.
  const executionAdjacency = new Map<string, { to: string; edgeIds: string[] }[]>();
  for (const execution of executionNodes) executionAdjacency.set(execution.id, []);
  for (const edge of dependencyEdges) {
    if (nodesById.get(edge.from)?.kind === "EXECUTION" && nodesById.get(edge.to)?.kind === "EXECUTION") {
      executionAdjacency.get(edge.from)!.push({ to: edge.to, edgeIds: [edge.id] });
    }
  }
  const ownerByData = new Map<string, string>();
  for (const edge of [...produceEdges, ...edgesByType.get("EXECUTION_BINDS_DATA")!]) {
    if (nodesById.get(edge.from)?.kind === "EXECUTION" && nodesById.get(edge.to)?.kind === "DATA") {
      const existingOwner = ownerByData.get(edge.to);
      if (existingOwner) {
        addViolation("MULTIPLE_DATA_OWNERS", [edge.to, existingOwner, edge.from], [edge.id]);
      } else {
        ownerByData.set(edge.to, edge.from);
      }
    }
  }
  for (const support of supportEdges) {
    const dataNode = nodesById.get(support.from);
    const controlNode = nodesById.get(support.to);
    if (dataNode?.kind !== "DATA" || controlNode?.kind !== "CONTROL" || controlNode.phase !== "PRE_EXECUTION") continue;
    const owner = ownerByData.get(dataNode.id);
    if (!owner) continue;
    for (const gate of gateEdges.filter((edge) => edge.from === controlNode.id)) {
      executionAdjacency.get(owner)?.push({ to: gate.to, edgeIds: [support.id, gate.id] });
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
