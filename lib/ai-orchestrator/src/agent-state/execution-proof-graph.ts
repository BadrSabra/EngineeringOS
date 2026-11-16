import { z } from "zod";
import {
  boundedContractSchema,
  boundedString,
  canonicalJsonHash,
} from "./contract-utils.js";

export const EXECUTION_PROOF_GRAPH_VERSION = 1 as const;
export const EXECUTION_PROOF_GRAPH_VALIDATOR_VERSION =
  "execution-proof-graph-validator.v1" as const;
export const EXECUTION_PROOF_GRAPH_MAX_NODES = 64;
export const EXECUTION_PROOF_GRAPH_MAX_EDGES = 128;
export const EXECUTION_PROOF_GRAPH_MAX_BYTES = 32 * 1024;

const digestSchema = boundedString(64).regex(/^[a-f0-9]{64}$/u);
const attemptSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sourceRevisionKindSchema = z.enum(["workspace_tree", "git_commit"]);
const sourceRevisionSourceSchema = z.enum([
  "delivery_tree_digest_v1",
  "git_commit_object_id",
]);
const commonNodeSchema = z.object({
  id: boundedString(200),
  projectId: boundedString(200),
  executionId: boundedString(200),
  attempt: attemptSchema,
});

export const ExecutionProofGraphNodeSchema = z.discriminatedUnion("kind", [
  commonNodeSchema.extend({
    kind: z.literal("EXECUTION"),
    operationId: boundedString(200),
    proofMode: z.literal("runtime_start_gate_c_v1"),
    recipeId: z.literal("runtime.start"),
    recipeVersion: z.literal(1),
    status: z.literal("completed"),
    sourceRevision: boundedString(128),
    candidateIdentity: digestSchema.nullable(),
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("ACCEPTANCE"),
    acceptanceId: boundedString(200),
    evidenceSnapshotId: boundedString(200),
    effectBundleId: boundedString(200),
    operationId: boundedString(200),
    outcome: z.literal("SUCCEEDED"),
    terminalStatus: z.literal("completed"),
    evidenceRequired: z.literal(true),
    evidenceComplete: z.literal(true),
    sourceRevision: boundedString(128),
    candidateIdentity: digestSchema.nullable(),
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("EVIDENCE_SNAPSHOT"),
    snapshotId: boundedString(200),
    operationId: boundedString(200),
    verdict: z.literal("PROVEN"),
    complete: z.literal(true),
    readCount: z.literal(0),
    artifactCount: z.literal(1),
    sourceRevision: boundedString(128),
    candidateIdentity: digestSchema.nullable(),
    artifactHash: digestSchema,
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("GATE_C_ARTIFACT"),
    artifactHash: digestSchema,
    artifactVersion: z.literal(2),
    operationId: boundedString(200),
    sourceRevision: boundedString(128),
    sourceRevisionKind: sourceRevisionKindSchema,
    sourceRevisionSource: sourceRevisionSourceSchema,
    workspaceIdentity: digestSchema,
    candidateIdentity: digestSchema.nullable(),
    episodeId: boundedString(200),
    actionId: boundedString(200),
    actionEventId: boundedString(200),
    committedEventId: boundedString(200),
    effectBundleId: boundedString(200),
    effectId: boundedString(200),
    actionHash: digestSchema,
    effectContractHash: digestSchema,
    environmentRevision: boundedString(80).regex(/^env-v1:[a-f0-9]{64}$/u),
    beforeObservationIds: z.array(boundedString(200)).min(2).max(8),
    afterObservationIds: z.array(boundedString(200)).min(2).max(16),
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("EPISODE"),
    episodeId: boundedString(200),
    projectRevision: boundedString(128),
    state: z.literal("completed"),
    verdict: z.literal("achieved"),
    reasonCode: z.literal("CANONICAL_PROOF_PROVEN"),
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("ACTION_EVENT"),
    eventId: boundedString(200),
    eventType: z.enum(["ACTION_REQUESTED", "ACTION_COMMITTED"]),
    actionId: boundedString(200),
    payloadHash: digestSchema,
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("EFFECT_BUNDLE"),
    effectBundleId: boundedString(200),
    verdict: z.literal("OBSERVED"),
    effectId: boundedString(200),
    effectContractHash: digestSchema,
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("EFFECT"),
    effectId: boundedString(200),
    actionId: boundedString(200),
    capabilityId: z.literal("runtime.start"),
    status: z.literal("observed"),
    effectContractHash: digestSchema,
    beforeObservationIds: z.array(boundedString(200)).min(2).max(8),
    afterObservationIds: z.array(boundedString(200)).min(2).max(16),
  }).strict(),
  commonNodeSchema.extend({
    kind: z.literal("OBSERVATION"),
    observationId: boundedString(200),
    observationRole: z.enum(["before", "after"]),
    predicate: z.enum([
      "runtime.before_state",
      "runtime.after_state",
      "runtime.status",
      "runtime.child_process_environment",
      "serving.status",
    ]),
    provenance: z.literal("DIRECT_OBSERVATION"),
    completeness: z.literal("complete"),
    freshness: z.enum(["fresh", "stale", "unknown"]),
    environmentFreshness: z.enum(["fresh", "stale", "unknown"]),
    sourceRevision: boundedString(128),
    environmentRevision: boundedString(80).regex(/^env-v1:[a-f0-9]{64}$/u),
    valueHash: digestSchema,
  }).strict(),
]);

export type ExecutionProofGraphNode = z.infer<typeof ExecutionProofGraphNodeSchema>;
export type ExecutionProofGraphNodeKind = ExecutionProofGraphNode["kind"];

const edgeBaseSchema = z.object({
  id: boundedString(200),
  from: boundedString(200),
  to: boundedString(200),
});

export const ExecutionProofGraphEdgeSchema = z.discriminatedUnion("type", [
  edgeBaseSchema.extend({ type: z.literal("EXECUTION_HAS_ACCEPTANCE") }),
  edgeBaseSchema.extend({ type: z.literal("ACCEPTANCE_HAS_SNAPSHOT") }),
  edgeBaseSchema.extend({ type: z.literal("EXECUTION_HAS_EPISODE") }),
  edgeBaseSchema.extend({ type: z.literal("EPISODE_HAS_EVENT") }),
  edgeBaseSchema.extend({ type: z.literal("EPISODE_HAS_EFFECT_BUNDLE") }),
  edgeBaseSchema.extend({ type: z.literal("BUNDLE_HAS_EFFECT") }),
  edgeBaseSchema.extend({ type: z.literal("EFFECT_HAS_OBSERVATION"), role: z.enum(["before", "after"]) }),
  edgeBaseSchema.extend({ type: z.literal("SNAPSHOT_HAS_ARTIFACT") }),
  edgeBaseSchema.extend({ type: z.literal("ARTIFACT_BINDS_EVENT") }),
  edgeBaseSchema.extend({ type: z.literal("ARTIFACT_BINDS_EFFECT_BUNDLE") }),
  edgeBaseSchema.extend({ type: z.literal("ARTIFACT_BINDS_EFFECT") }),
  edgeBaseSchema.extend({ type: z.literal("ARTIFACT_BINDS_OBSERVATION"), role: z.enum(["before", "after"]) }),
]);

export type ExecutionProofGraphEdge = z.infer<typeof ExecutionProofGraphEdgeSchema>;
export type ExecutionProofGraphEdgeInput = ExecutionProofGraphEdge extends infer Edge
  ? Edge extends { id: string }
    ? Omit<Edge, "id">
    : never
  : never;

export const ExecutionProofGraphSchema = boundedContractSchema(z.object({
  version: z.literal(EXECUTION_PROOF_GRAPH_VERSION),
  profile: z.literal("runtime_start_gate_c_v1"),
  graphId: boundedString(200),
  projectId: boundedString(200),
  executionId: boundedString(200),
  attempt: attemptSchema,
  operationId: boundedString(200),
  sourceRevision: boundedString(128),
  sourceRevisionKind: sourceRevisionKindSchema,
  sourceRevisionSource: sourceRevisionSourceSchema,
  candidateIdentity: digestSchema.nullable(),
  environmentRevision: boundedString(80).regex(/^env-v1:[a-f0-9]{64}$/u),
  nodes: z.array(ExecutionProofGraphNodeSchema).min(1).max(EXECUTION_PROOF_GRAPH_MAX_NODES),
  edges: z.array(ExecutionProofGraphEdgeSchema).max(EXECUTION_PROOF_GRAPH_MAX_EDGES),
}).strict().superRefine((graph, ctx) => {
  const isWorkspaceRevision = graph.sourceRevisionKind === "workspace_tree"
    && graph.sourceRevisionSource === "delivery_tree_digest_v1"
    && /^workspace-tree-v1:[a-f0-9]{64}$/u.test(graph.sourceRevision);
  const isGitRevision = graph.sourceRevisionKind === "git_commit"
    && graph.sourceRevisionSource === "git_commit_object_id"
    && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/iu.test(graph.sourceRevision);
  if (!isWorkspaceRevision && !isGitRevision) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceRevision"],
      message: "source revision does not match its declared provenance",
    });
  }
}), EXECUTION_PROOF_GRAPH_MAX_BYTES);

export type ExecutionProofGraph = z.infer<typeof ExecutionProofGraphSchema>;

export type ExecutionProofGraphViolationCode =
  | "SCHEMA_INVALID"
  | "GRAPH_ID_MISMATCH"
  | "NODE_ID_MISMATCH"
  | "DUPLICATE_NODE"
  | "IDENTITY_MISMATCH"
  | "REVISION_MISMATCH"
  | "STALE_EVIDENCE"
  | "MISSING_REQUIRED_NODE"
  | "DUPLICATE_REQUIRED_NODE"
  | "OBSERVATION_SET_MISMATCH"
  | "DUPLICATE_EDGE"
  | "DANGLING_EDGE"
  | "EDGE_ID_MISMATCH"
  | "EDGE_TYPE_MISMATCH"
  | "MISSING_REQUIRED_EDGE"
  | "UNEXPECTED_EDGE";

export type ExecutionProofGraphViolation = {
  code: ExecutionProofGraphViolationCode;
  path: string[];
  edgeIds: string[];
};

export type ExecutionProofGraphValidationResult = {
  validatorVersion: typeof EXECUTION_PROOF_GRAPH_VALIDATOR_VERSION;
  authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY";
  verdict: "PASS" | "FAIL";
  graphHash: string | null;
  violations: ExecutionProofGraphViolation[];
};

type NodeIdentity = Pick<ExecutionProofGraphNode, "kind"> & {
  sourceId: string;
};

export function executionProofGraphNodeId(kind: ExecutionProofGraphNodeKind, sourceId: string): string {
  return `${kind.toLowerCase()}:${canonicalJsonHash([kind, sourceId])}`;
}

export function executionProofGraphId(
  projectId: string,
  executionId: string,
  attempt: number,
): string {
  return `execution-proof:${canonicalJsonHash([
    "runtime_start_gate_c_v1",
    projectId,
    executionId,
    attempt,
  ])}`;
}

function sourceIdentity(node: ExecutionProofGraphNode): NodeIdentity {
  switch (node.kind) {
    case "EXECUTION": return { kind: node.kind, sourceId: node.executionId };
    case "ACCEPTANCE": return { kind: node.kind, sourceId: node.acceptanceId };
    case "EVIDENCE_SNAPSHOT": return { kind: node.kind, sourceId: node.snapshotId };
    case "GATE_C_ARTIFACT": return { kind: node.kind, sourceId: node.artifactHash };
    case "EPISODE": return { kind: node.kind, sourceId: node.episodeId };
    case "ACTION_EVENT": return { kind: node.kind, sourceId: node.eventId };
    case "EFFECT_BUNDLE": return { kind: node.kind, sourceId: node.effectBundleId };
    case "EFFECT": return { kind: node.kind, sourceId: node.effectId };
    case "OBSERVATION": return { kind: node.kind, sourceId: node.observationId };
  }
}

function edgeIdentity(edge: ExecutionProofGraphEdgeInput | ExecutionProofGraphEdge): string {
  return canonicalJsonHash([
    edge.type,
    edge.from,
    edge.to,
    "role" in edge ? edge.role : null,
  ]);
}

export function executionProofGraphEdgeId(edge: ExecutionProofGraphEdgeInput): string {
  return `edge:${edgeIdentity(edge)}`;
}

function canonicalGraph(graph: ExecutionProofGraph): ExecutionProofGraph {
  return {
    ...graph,
    nodes: [...graph.nodes].sort((left, right) => compareString(left.id, right.id)),
    edges: [...graph.edges].sort((left, right) =>
      compareString(left.type, right.type)
      || compareString(left.from, right.from)
      || compareString(left.to, right.to)
      || compareString("role" in left ? left.role : "", "role" in right ? right.role : "")
      || compareString(left.id, right.id)),
  };
}

export function hashExecutionProofGraph(graph: ExecutionProofGraph): string {
  const parsed = ExecutionProofGraphSchema.parse(graph);
  return canonicalJsonHash(canonicalGraph(parsed) as Parameters<typeof canonicalJsonHash>[0]);
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortViolations(violations: ExecutionProofGraphViolation[]): ExecutionProofGraphViolation[] {
  return violations.sort((left, right) =>
    compareString(left.code, right.code)
    || compareString(left.path.join("\u0000"), right.path.join("\u0000"))
    || compareString(left.edgeIds.join("\u0000"), right.edgeIds.join("\u0000")));
}

function addExpectedEdge(
  edges: ExecutionProofGraphEdgeInput[],
  edge: ExecutionProofGraphEdgeInput,
): void {
  edges.push(edge);
}

function expectedEdges(graph: ExecutionProofGraph): ExecutionProofGraphEdgeInput[] {
  const byKind = new Map<ExecutionProofGraphNodeKind, ExecutionProofGraphNode[]>();
  for (const node of graph.nodes) {
    byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node]);
  }
  const one = (kind: ExecutionProofGraphNodeKind) => byKind.get(kind)?.length === 1
    ? byKind.get(kind)![0]
    : undefined;
  const execution = one("EXECUTION");
  const acceptance = one("ACCEPTANCE");
  const snapshot = one("EVIDENCE_SNAPSHOT");
  const artifact = one("GATE_C_ARTIFACT");
  const episode = one("EPISODE");
  const bundle = one("EFFECT_BUNDLE");
  const effect = one("EFFECT");
  if (
    execution?.kind !== "EXECUTION"
    || acceptance?.kind !== "ACCEPTANCE"
    || snapshot?.kind !== "EVIDENCE_SNAPSHOT"
    || artifact?.kind !== "GATE_C_ARTIFACT"
    || episode?.kind !== "EPISODE"
    || bundle?.kind !== "EFFECT_BUNDLE"
    || effect?.kind !== "EFFECT"
  ) return [];

  const events = byKind.get("ACTION_EVENT") ?? [];
  const observations = byKind.get("OBSERVATION") ?? [];
  const result: ExecutionProofGraphEdgeInput[] = [];
  addExpectedEdge(result, {
    type: "EXECUTION_HAS_ACCEPTANCE",
    from: execution.id,
    to: acceptance.id,
  });
  addExpectedEdge(result, {
    type: "ACCEPTANCE_HAS_SNAPSHOT",
    from: acceptance.id,
    to: snapshot.id,
  });
  addExpectedEdge(result, {
    type: "EXECUTION_HAS_EPISODE",
    from: execution.id,
    to: episode.id,
  });
  addExpectedEdge(result, {
    type: "EPISODE_HAS_EFFECT_BUNDLE",
    from: episode.id,
    to: bundle.id,
  });
  addExpectedEdge(result, {
    type: "BUNDLE_HAS_EFFECT",
    from: bundle.id,
    to: effect.id,
  });
  addExpectedEdge(result, {
    type: "SNAPSHOT_HAS_ARTIFACT",
    from: snapshot.id,
    to: artifact.id,
  });
  for (const event of events) {
    addExpectedEdge(result, {
      type: "EPISODE_HAS_EVENT",
      from: episode.id,
      to: event.id,
    });
    addExpectedEdge(result, {
      type: "ARTIFACT_BINDS_EVENT",
      from: artifact.id,
      to: event.id,
    });
  }
  addExpectedEdge(result, {
    type: "ARTIFACT_BINDS_EFFECT_BUNDLE",
    from: artifact.id,
    to: bundle.id,
  });
  addExpectedEdge(result, {
    type: "ARTIFACT_BINDS_EFFECT",
    from: artifact.id,
    to: effect.id,
  });
  for (const observation of observations) {
    if (observation.kind !== "OBSERVATION") continue;
    addExpectedEdge(result, {
      type: "EFFECT_HAS_OBSERVATION",
      from: effect.id,
      to: observation.id,
      role: observation.observationRole,
    });
    addExpectedEdge(result, {
      type: "ARTIFACT_BINDS_OBSERVATION",
      from: artifact.id,
      to: observation.id,
      role: observation.observationRole,
    });
  }
  return result;
}

function semanticEdgeKey(edge: ExecutionProofGraphEdge): string {
  return JSON.stringify([edge.type, edge.from, edge.to, "role" in edge ? edge.role : null]);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

export function validateExecutionProofGraph(input: unknown): ExecutionProofGraphValidationResult {
  const parsed = ExecutionProofGraphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      validatorVersion: EXECUTION_PROOF_GRAPH_VALIDATOR_VERSION,
      authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY",
      verdict: "FAIL",
      graphHash: null,
      violations: sortViolations(parsed.error.issues.map((issue) => ({
        code: "SCHEMA_INVALID",
        path: issue.path.map(String),
        edgeIds: [],
      }))),
    };
  }

  const graph = canonicalGraph(parsed.data);
  const graphHash = hashExecutionProofGraph(graph);
  const violations: ExecutionProofGraphViolation[] = [];
  const add = (
    code: ExecutionProofGraphViolationCode,
    path: string[],
    edgeIds: string[] = [],
  ) => violations.push({ code, path, edgeIds: [...edgeIds].sort(compareString) });
  const nodesById = new Map<string, ExecutionProofGraphNode>();

  if (graph.graphId !== executionProofGraphId(graph.projectId, graph.executionId, graph.attempt)) {
    add("GRAPH_ID_MISMATCH", ["graphId"]);
  }
  for (const node of graph.nodes) {
    if (nodesById.has(node.id)) {
      add("DUPLICATE_NODE", ["nodes", node.id]);
    } else {
      nodesById.set(node.id, node);
    }
    const identity = sourceIdentity(node);
    if (node.id !== executionProofGraphNodeId(identity.kind, identity.sourceId)) {
      add("NODE_ID_MISMATCH", ["nodes", node.id, "id"]);
    }
    if (
      node.projectId !== graph.projectId
      || node.executionId !== graph.executionId
      || node.attempt !== graph.attempt
    ) {
      add("IDENTITY_MISMATCH", ["nodes", node.id]);
    }
    if (
      (node.kind === "EXECUTION"
        || node.kind === "ACCEPTANCE"
        || node.kind === "EVIDENCE_SNAPSHOT"
        || node.kind === "EPISODE"
        || node.kind === "OBSERVATION")
      && (node.kind === "EPISODE" ? node.projectRevision : node.sourceRevision) !== graph.sourceRevision
    ) {
      add("REVISION_MISMATCH", ["nodes", node.id, "sourceRevision"]);
    }
    if (
      (node.kind === "EXECUTION" || node.kind === "ACCEPTANCE" || node.kind === "EVIDENCE_SNAPSHOT")
      && (
        node.kind === "EXECUTION" ? node.operationId : node.operationId
      ) !== graph.operationId
    ) {
      add("IDENTITY_MISMATCH", ["nodes", node.id, "operationId"]);
    }
    if (
      (node.kind === "EXECUTION" || node.kind === "ACCEPTANCE" || node.kind === "EVIDENCE_SNAPSHOT")
      && node.candidateIdentity !== graph.candidateIdentity
    ) {
      add("IDENTITY_MISMATCH", ["nodes", node.id, "candidateIdentity"]);
    }
    if (
      node.kind === "OBSERVATION"
      && (
        node.environmentRevision !== graph.environmentRevision
        || node.freshness !== "fresh"
        || node.environmentFreshness !== "fresh"
        || node.provenance !== "DIRECT_OBSERVATION"
        || node.completeness !== "complete"
      )
    ) {
      add(
        node.freshness !== "fresh" || node.environmentFreshness !== "fresh"
          ? "STALE_EVIDENCE"
          : "IDENTITY_MISMATCH",
        ["nodes", node.id, "observation"],
      );
    }
  }

  const exactlyOneKinds: ExecutionProofGraphNodeKind[] = [
    "EXECUTION",
    "ACCEPTANCE",
    "EVIDENCE_SNAPSHOT",
    "GATE_C_ARTIFACT",
    "EPISODE",
    "EFFECT_BUNDLE",
    "EFFECT",
  ];
  for (const kind of exactlyOneKinds) {
    const count = graph.nodes.filter((node) => node.kind === kind).length;
    if (count === 0) add("MISSING_REQUIRED_NODE", ["nodes", kind]);
    else if (count > 1) add("DUPLICATE_REQUIRED_NODE", ["nodes", kind]);
  }
  const events = graph.nodes.filter((node) => node.kind === "ACTION_EVENT");
  const requestedEventCount = events.filter((node) => (
    node.kind === "ACTION_EVENT" && node.eventType === "ACTION_REQUESTED"
  )).length;
  const committedEventCount = events.filter((node) => (
    node.kind === "ACTION_EVENT" && node.eventType === "ACTION_COMMITTED"
  )).length;
  if (events.length === 0) {
    add("MISSING_REQUIRED_NODE", ["nodes", "ACTION_EVENT"]);
  } else if (events.length !== 2 || requestedEventCount !== 1 || committedEventCount !== 1) {
    add("DUPLICATE_REQUIRED_NODE", ["nodes", "ACTION_EVENT"]);
  }
  const observations = graph.nodes.filter((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "OBSERVATION" }
  > => node.kind === "OBSERVATION");
  const beforeIds = observations.filter((node) => node.observationRole === "before")
    .map((node) => node.observationId);
  const afterIds = observations.filter((node) => node.observationRole === "after")
    .map((node) => node.observationId);
  if (
    beforeIds.length < 2 || beforeIds.length > 8
    || afterIds.length < 2 || afterIds.length > 16
    || new Set([...beforeIds, ...afterIds]).size !== beforeIds.length + afterIds.length
  ) {
    add("OBSERVATION_SET_MISMATCH", ["nodes", "OBSERVATION"]);
  }
  const countPredicate = (
    role: "before" | "after",
    predicate: Extract<ExecutionProofGraphNode, { kind: "OBSERVATION" }>["predicate"],
  ) => observations.filter((node) => node.observationRole === role && node.predicate === predicate).length;
  if (
    countPredicate("before", "runtime.before_state") !== 1
    || countPredicate("before", "serving.status") !== 1
    || countPredicate("after", "runtime.after_state") !== 1
    || countPredicate("after", "runtime.status") !== 1
    || countPredicate("after", "serving.status") !== 1
  ) {
    add("OBSERVATION_SET_MISMATCH", ["nodes", "OBSERVATION", "predicate"]);
  }

  const artifact = graph.nodes.find((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "GATE_C_ARTIFACT" }
  > => node.kind === "GATE_C_ARTIFACT");
  const acceptance = graph.nodes.find((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "ACCEPTANCE" }
  > => node.kind === "ACCEPTANCE");
  const snapshot = graph.nodes.find((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "EVIDENCE_SNAPSHOT" }
  > => node.kind === "EVIDENCE_SNAPSHOT");
  const effect = graph.nodes.find((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "EFFECT" }
  > => node.kind === "EFFECT");
  const bundle = graph.nodes.find((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "EFFECT_BUNDLE" }
  > => node.kind === "EFFECT_BUNDLE");
  const actionEvents = events.filter((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "ACTION_EVENT" }
  > => node.kind === "ACTION_EVENT");
  const requestedEvent = actionEvents.find((node) => node.eventType === "ACTION_REQUESTED");
  const committedEvent = actionEvents.find((node) => node.eventType === "ACTION_COMMITTED");
  const episode = graph.nodes.find((node): node is Extract<
    ExecutionProofGraphNode,
    { kind: "EPISODE" }
  > => node.kind === "EPISODE");
  if (artifact && (
    artifact.operationId !== graph.operationId
    || artifact.candidateIdentity !== graph.candidateIdentity
    || artifact.episodeId !== episode?.episodeId
    || artifact.environmentRevision !== graph.environmentRevision
  )) {
    add("IDENTITY_MISMATCH", ["nodes", artifact.id]);
  }
  if (artifact && (
    artifact.sourceRevision !== graph.sourceRevision
    || artifact.sourceRevisionKind !== graph.sourceRevisionKind
    || artifact.sourceRevisionSource !== graph.sourceRevisionSource
  )) {
    add("REVISION_MISMATCH", ["nodes", artifact.id, "sourceRevision"]);
  }
  if (
    (artifact && snapshot && snapshot.artifactHash !== artifact.artifactHash)
    || (artifact && bundle && artifact.effectBundleId !== bundle.effectBundleId)
    || (artifact && effect && artifact.effectId !== effect.effectId)
    || (artifact && requestedEvent && artifact.actionEventId !== requestedEvent.eventId)
    || (artifact && committedEvent && artifact.committedEventId !== committedEvent.eventId)
    || (artifact && effect && artifact.actionId !== effect.actionId)
    || (artifact && requestedEvent && artifact.actionId !== requestedEvent.actionId)
    || (artifact && committedEvent && artifact.actionId !== committedEvent.actionId)
    || (artifact && effect && artifact.effectContractHash !== effect.effectContractHash)
    || (artifact && bundle && artifact.effectContractHash !== bundle.effectContractHash)
    || (bundle && effect && bundle.effectId !== effect.effectId)
  ) {
    add("IDENTITY_MISMATCH", ["nodes", "GATE_C_ARTIFACT"]);
  }
  if (
    !artifact || !effect
    || !sameSet(artifact.beforeObservationIds, beforeIds)
    || !sameSet(artifact.afterObservationIds, afterIds)
    || !sameSet(effect.beforeObservationIds, beforeIds)
    || !sameSet(effect.afterObservationIds, afterIds)
  ) {
    add("OBSERVATION_SET_MISMATCH", ["nodes", "GATE_C_ARTIFACT"]);
  }
  if (
    acceptance && snapshot && bundle
    && (
      acceptance.evidenceSnapshotId !== snapshot.snapshotId
      || acceptance.effectBundleId !== bundle.effectBundleId
    )
  ) {
    add("IDENTITY_MISMATCH", ["nodes", "ACCEPTANCE"]);
  }

  const edgesById = new Map<string, ExecutionProofGraphEdge>();
  const edgesBySemantic = new Map<string, ExecutionProofGraphEdge[]>();
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      add("DANGLING_EDGE", [edge.from, edge.to], [edge.id]);
      continue;
    }
    const expectedId = executionProofGraphEdgeId(edge);
    if (edge.id !== expectedId) add("EDGE_ID_MISMATCH", ["edges", edge.id, "id"], [edge.id]);
    if (edgesById.has(edge.id)) add("DUPLICATE_EDGE", ["edges", edge.id], [edge.id]);
    edgesById.set(edge.id, edge);
    const semanticKey = semanticEdgeKey(edge);
    edgesBySemantic.set(semanticKey, [...(edgesBySemantic.get(semanticKey) ?? []), edge]);
    const from = nodesById.get(edge.from)!;
    const to = nodesById.get(edge.to)!;
    const valid =
      (edge.type === "EXECUTION_HAS_ACCEPTANCE" && from.kind === "EXECUTION" && to.kind === "ACCEPTANCE")
      || (edge.type === "ACCEPTANCE_HAS_SNAPSHOT" && from.kind === "ACCEPTANCE" && to.kind === "EVIDENCE_SNAPSHOT")
      || (edge.type === "EXECUTION_HAS_EPISODE" && from.kind === "EXECUTION" && to.kind === "EPISODE")
      || (edge.type === "EPISODE_HAS_EVENT" && from.kind === "EPISODE" && to.kind === "ACTION_EVENT")
      || (edge.type === "EPISODE_HAS_EFFECT_BUNDLE" && from.kind === "EPISODE" && to.kind === "EFFECT_BUNDLE")
      || (edge.type === "BUNDLE_HAS_EFFECT" && from.kind === "EFFECT_BUNDLE" && to.kind === "EFFECT")
      || (edge.type === "EFFECT_HAS_OBSERVATION" && from.kind === "EFFECT" && to.kind === "OBSERVATION"
        && edge.role === to.observationRole)
      || (edge.type === "SNAPSHOT_HAS_ARTIFACT" && from.kind === "EVIDENCE_SNAPSHOT" && to.kind === "GATE_C_ARTIFACT")
      || (edge.type === "ARTIFACT_BINDS_EVENT" && from.kind === "GATE_C_ARTIFACT" && to.kind === "ACTION_EVENT")
      || (edge.type === "ARTIFACT_BINDS_EFFECT_BUNDLE" && from.kind === "GATE_C_ARTIFACT" && to.kind === "EFFECT_BUNDLE")
      || (edge.type === "ARTIFACT_BINDS_EFFECT" && from.kind === "GATE_C_ARTIFACT" && to.kind === "EFFECT")
      || (edge.type === "ARTIFACT_BINDS_OBSERVATION" && from.kind === "GATE_C_ARTIFACT"
        && to.kind === "OBSERVATION" && edge.role === to.observationRole);
    if (!valid) add("EDGE_TYPE_MISMATCH", [edge.from, edge.to], [edge.id]);
  }
  for (const matching of edgesBySemantic.values()) {
    if (matching.length > 1) {
      add("DUPLICATE_EDGE", [matching[0]!.from, matching[0]!.to], matching.map((edge) => edge.id));
    }
  }
  const expected = expectedEdges(graph).map((edge) => ({
    ...edge,
    id: executionProofGraphEdgeId(edge),
  } as ExecutionProofGraphEdge));
  const expectedKeys = new Set(expected.map(semanticEdgeKey));
  const actualKeys = new Set(graph.edges.map(semanticEdgeKey));
  for (const edge of expected) {
    if (!actualKeys.has(semanticEdgeKey(edge))) {
      add("MISSING_REQUIRED_EDGE", [edge.from, edge.to], [edge.id]);
    }
  }
  for (const edge of graph.edges) {
    if (!expectedKeys.has(semanticEdgeKey(edge))) {
      add("UNEXPECTED_EDGE", [edge.from, edge.to], [edge.id]);
    }
  }

  return {
    validatorVersion: EXECUTION_PROOF_GRAPH_VALIDATOR_VERSION,
    authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY",
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    graphHash,
    violations: sortViolations(violations),
  };
}
