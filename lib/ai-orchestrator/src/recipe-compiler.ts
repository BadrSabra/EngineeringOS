import {
  CapabilityRegistry,
  type CapabilityFailure,
} from "./capability-contract.js";
import {
  ActiveTaskExecutionPlanSchema,
  ExecutionNodeSchema,
  type ActiveTaskExecutionPlan,
  type ExecutionNode,
} from "./task-session-state.js";
import { ValidationProfileSchema, type ValidationProfile } from "./schemas/chat.schema.js";
import {
  CapabilityRecipeSchema,
  CompiledEvidencePredicateSchema,
  CompiledRecipeTransitionSchema,
  RecipeContextSchema,
  RecipeExecutionPolicySchema,
  RecipeStateSchema,
  type CapabilityRecipe,
  type CapabilityRecipeNode,
  type CompiledRecipeTransition,
  type EvidencePredicate,
  type RecipeContext,
  type RecipeEvidence,
  type RecipeExecutionPolicy,
  type RecipeState,
  type RecipeTarget,
} from "./recipe-contract.js";

export const DEFAULT_RECIPE_EXECUTION_POLICY: RecipeExecutionPolicy = {
  maxNodes: 24,
  maxTransitions: 48,
  maxBranchesPerNode: 4,
  maxPredicateDepth: 6,
  maxAttempts: 3,
  nodeTimeoutMs: 120_000,
  maxTotalTimeoutMs: 900_000,
};

export type RecipeCompilationDiagnosticCode =
  | "RECIPE_INVALID"
  | "RECIPE_VERSION_UNSUPPORTED"
  | "RECIPE_TOO_LARGE"
  | "DUPLICATE_NODE_ID"
  | "UNKNOWN_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "CAPABILITY_UNKNOWN_ID"
  | "CAPABILITY_RECIPE_VERSION_UNSUPPORTED"
  | "CAPABILITY_INPUT_INVALID"
  | "CAPABILITY_INPUT_TOO_LARGE"
  | "CAPABILITY_OPERATION_NOT_ALLOWED"
  | "CAPABILITY_PROFILE_NOT_APPROVED"
  | "CAPABILITY_APPROVAL_REQUIRED"
  | "CAPABILITY_AUTHORIZATION_REQUIRED"
  | "CAPABILITY_SCOPE_UNSUPPORTED"
  | "CAPABILITY_RISK_NOT_ALLOWED"
  | "DUPLICATE_TRANSITION_ID"
  | "UNKNOWN_TRANSITION_NODE"
  | "UNKNOWN_TRANSITION_TARGET"
  | "UNDECLARED_OUTPUT"
  | "CONTRADICTORY_PREDICATE"
  | "PREDICATE_TOO_DEEP"
  | "TOO_MANY_BRANCHES"
  | "PLAN_TOO_LARGE"
  | "UNREACHABLE_NODE"
  | "NON_TERMINATING_PLAN"
  | "INVALID_VALIDATION_PROFILE";

export type RecipeCompilationDiagnostic = {
  code: RecipeCompilationDiagnosticCode;
  path: string;
  detail: string;
};

export type RecipeCompilationResult =
  | { ok: true; plan: ActiveTaskExecutionPlan }
  | { ok: false; diagnostics: RecipeCompilationDiagnostic[] };

export class RecipeCompilationError extends Error {
  public readonly diagnostics: readonly RecipeCompilationDiagnostic[];

  public constructor(diagnostics: readonly RecipeCompilationDiagnostic[]) {
    super(diagnostics.map((diagnostic) => `${diagnostic.code} at ${diagnostic.path}: ${diagnostic.detail}`).join("; "));
    this.name = "RecipeCompilationError";
    this.diagnostics = diagnostics;
  }
}

export type RecipeCompilationContext = Omit<RecipeContext, "operation" | "scope"> & {
  operation?: string;
  scope?: RecipeContext["scope"];
  allowedFiles?: readonly string[];
  authorized?: boolean;
  approvalState?: "APPROVED" | "PENDING_APPROVAL" | "REJECTED";
  approvedCommandProfiles?: ReadonlySet<string>;
  maxRisk?: "low" | "medium" | "high" | "critical";
  validationProfile?: ValidationProfile;
};

export type CompileCapabilityRecipeOptions = {
  registry: CapabilityRegistry;
  context: RecipeCompilationContext;
  policy?: RecipeExecutionPolicy;
};

const RISK_ORDER = ["low", "medium", "high", "critical"] as const;
const CONTROL_KEYS = new Set([
  "args", "argv", "command", "commandline", "commandtext", "cwd", "env",
  "environment", "executable", "executablepath", "profile", "shell",
  "shellcommand", "timeout", "timeoutms", "retries", "retry", "workdir",
  "workingdir", "workingdirectory",
]);

function diagnostic(
  code: RecipeCompilationDiagnosticCode,
  path: string,
  detail: string,
): RecipeCompilationDiagnostic {
  return { code, path, detail };
}

function nodeId(recipeId: string, sourceId: string): string {
  return `recipe:${recipeId}:${sourceId}`;
}

function transitionId(recipeId: string, sourceId: string): string {
  return `recipe:${recipeId}:transition:${sourceId}`;
}

function normalizedPath(value: string): string {
  return value.trim().replace(/^\.\/+/, "").replace(/\\/g, "/");
}

function hasControlKey(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
  if (depth > 12 || value === null || typeof value !== "object") return depth > 12;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasControlKey(item, depth + 1, seen));
  return Object.entries(value).some(([key, child]) =>
    CONTROL_KEYS.has(key.replace(/[_-]/g, "").toLowerCase()) || hasControlKey(child, depth + 1, seen),
  );
}

function predicateDepth(predicate: EvidencePredicate, depth = 1): number {
  if (predicate.kind === "all" || predicate.kind === "any") {
    return Math.max(depth, ...predicate.predicates.map((child) => predicateDepth(child, depth + 1)));
  }
  if (predicate.kind === "not") return predicateDepth(predicate.predicate, depth + 1);
  return depth;
}

function predicateKey(predicate: EvidencePredicate): string {
  return JSON.stringify(predicate);
}

function findContradiction(predicate: EvidencePredicate): boolean {
  if (predicate.kind === "all") {
    const keys = new Set(predicate.predicates.map(predicateKey));
    for (const child of predicate.predicates) {
      if (child.kind === "not" && keys.has(predicateKey(child.predicate))) return true;
    }
    const statuses = new Map<string, string>();
    for (const child of predicate.predicates) {
      if (child.kind !== "node_status") continue;
      const previous = statuses.get(child.nodeId);
      if (previous && previous !== child.status) return true;
      statuses.set(child.nodeId, child.status);
    }
    return predicate.predicates.some(findContradiction);
  }
  if (predicate.kind === "any") return predicate.predicates.some(findContradiction);
  if (predicate.kind === "not") return findContradiction(predicate.predicate);
  return false;
}

function mapPredicate(
  predicate: EvidencePredicate,
  sourceNodes: ReadonlyMap<string, CapabilityRecipeNode>,
  compiledIds: ReadonlyMap<string, string>,
  diagnostics: RecipeCompilationDiagnostic[],
  path: string,
): EvidencePredicate {
  const mapNode = (sourceId: string, childPath: string): string => {
    const id = compiledIds.get(sourceId);
    if (!sourceNodes.has(sourceId)) {
      diagnostics.push(diagnostic("UNKNOWN_TRANSITION_NODE", childPath, `Node "${sourceId}" is not declared.`));
    }
    return id ?? nodeId("invalid", sourceId);
  };
  if (predicate.kind === "all" || predicate.kind === "any") {
    return {
      ...predicate,
      predicates: predicate.predicates.map((child, index) =>
        mapPredicate(child, sourceNodes, compiledIds, diagnostics, `${path}.predicates[${index}]`)),
    };
  }
  if (predicate.kind === "not") {
    return {
      kind: "not",
      predicate: mapPredicate(predicate.predicate, sourceNodes, compiledIds, diagnostics, `${path}.predicate`),
    };
  }
  const mapped = { ...predicate, nodeId: mapNode(predicate.nodeId, `${path}.nodeId`) };
  if (predicate.kind === "output_present" || predicate.kind === "output_equals") {
    const source = sourceNodes.get(predicate.nodeId);
    if (source && !source.declaredOutputs.includes(predicate.output)) {
      diagnostics.push(diagnostic(
        "UNDECLARED_OUTPUT",
        `${path}.output`,
        `Output "${predicate.output}" is not declared by node "${predicate.nodeId}".`,
      ));
    }
  }
  return mapped;
}

function mapTarget(
  target: RecipeTarget,
  compiledIds: ReadonlyMap<string, string>,
  diagnostics: RecipeCompilationDiagnostic[],
  path: string,
): RecipeTarget {
  if (target.kind === "terminal") return target;
  const mapped = compiledIds.get(target.nodeId);
  if (!mapped) {
    diagnostics.push(diagnostic("UNKNOWN_TRANSITION_TARGET", `${path}.nodeId`, `Node "${target.nodeId}" is not declared.`));
  }
  return { kind: "node", nodeId: mapped ?? nodeId("invalid", target.nodeId) };
}

function topologicalOrder(
  nodes: readonly CapabilityRecipeNode[],
  ids: ReadonlySet<string>,
  diagnostics: RecipeCompilationDiagnostic[],
): CapabilityRecipeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const dependents = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) {
        diagnostics.push(diagnostic("UNKNOWN_DEPENDENCY", `nodes.${node.id}.dependsOn`, `Node "${dependency}" is not declared.`));
        continue;
      }
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      dependents.get(dependency)?.push(node.id);
    }
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered: CapabilityRecipeNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(byId.get(current)!);
    for (const dependent of dependents.get(current) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  if (ordered.length !== nodes.length) {
    diagnostics.push(diagnostic("DEPENDENCY_CYCLE", "nodes", "Recipe dependencies must form an acyclic graph."));
  }
  return ordered;
}

function graphHasCycle(transitions: readonly CompiledRecipeTransition[]): boolean {
  const graph = new Map<string, string[]>();
  for (const transition of transitions) {
    const targets = [transition.then, transition.otherwise]
      .filter((target): target is { kind: "node"; nodeId: string } => target.kind === "node")
      .map((target) => target.nodeId);
    graph.set(transition.fromNodeId, [...(graph.get(transition.fromNodeId) ?? []), ...targets]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) ?? []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some(visit);
}

function everyNodeCanTerminate(
  nodes: readonly ExecutionNode[],
  transitions: readonly CompiledRecipeTransition[],
): boolean {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, CompiledRecipeTransition[]>();
  for (const transition of transitions) {
    outgoing.set(transition.fromNodeId, [...(outgoing.get(transition.fromNodeId) ?? []), transition]);
  }
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const canTerminate = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const result = (outgoing.get(id) ?? []).length > 0
      && (outgoing.get(id) ?? []).every((transition) =>
        [transition.then, transition.otherwise].every((target) =>
          target.kind === "terminal" || (nodeIds.has(target.nodeId) && canTerminate(target.nodeId)),
        ));
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };
  return nodes.every((node) => canTerminate(node.id));
}

function safeFailureCode(failure: CapabilityFailure): RecipeCompilationDiagnosticCode {
  switch (failure.code) {
    case "CAPABILITY_RECIPE_VERSION_UNSUPPORTED": return failure.code;
    case "CAPABILITY_INPUT_TOO_LARGE": return failure.code;
    case "CAPABILITY_OPERATION_NOT_ALLOWED": return failure.code;
    case "CAPABILITY_PROFILE_NOT_APPROVED": return failure.code;
    case "CAPABILITY_APPROVAL_REQUIRED": return failure.code;
    default: return failure.code === "CAPABILITY_UNKNOWN_ID"
      ? failure.code
      : "CAPABILITY_INPUT_INVALID";
  }
}

function parseRecipe(value: unknown): { recipe?: CapabilityRecipe; diagnostics: RecipeCompilationDiagnostic[] } {
  const parsed = CapabilityRecipeSchema.safeParse(value);
  if (parsed.success) return { recipe: parsed.data, diagnostics: [] };
  return {
    diagnostics: parsed.error.issues.map((issue) =>
      diagnostic("RECIPE_INVALID", issue.path.join(".") || "$", issue.message)),
  };
}

function buildNode(
  recipe: CapabilityRecipe,
  source: CapabilityRecipeNode,
  compiledIds: ReadonlyMap<string, string>,
  context: RecipeCompilationContext,
  policy: RecipeExecutionPolicy,
): ExecutionNode {
  const profile = context.validationProfile ?? "workspace-typecheck";
  ValidationProfileSchema.parse(profile);
  const recipeContext = RecipeContextSchema.parse({
    projectId: context.projectId,
    rootPath: context.rootPath,
    revision: context.revision,
    operation: context.operation,
    scope: context.scope,
  });
  return ExecutionNodeSchema.parse({
    id: compiledIds.get(source.id),
    title: source.title,
    status: "queued",
    allowedFiles: [...new Set((context.allowedFiles ?? []).map(normalizedPath).filter(Boolean))].slice(0, 48),
    dependencies: source.dependsOn.map((dependency) => compiledIds.get(dependency)).filter(Boolean),
    validationProfile: profile,
    attempts: 0,
    validationAttempts: 0,
    capabilityId: source.capabilityId,
    recipeVersion: source.recipeVersion,
    capabilityInput: source.input,
    declaredOutputs: source.declaredOutputs,
    executionTimeoutMs: policy.nodeTimeoutMs,
    maxAttempts: policy.maxAttempts,
    executionContext: recipeContext,
  });
}

function addAutomaticTransitions(
  recipe: CapabilityRecipe,
  ordered: readonly CapabilityRecipeNode[],
  compiledIds: ReadonlyMap<string, string>,
  transitions: CompiledRecipeTransition[],
  policy: RecipeExecutionPolicy,
  successPredicate: EvidencePredicate,
): void {
  const fromNodes = new Set(transitions.map((transition) => transition.fromNodeId));
  for (let index = 0; index < ordered.length; index += 1) {
    const source = ordered[index]!;
    const fromNodeId = compiledIds.get(source.id)!;
    if (fromNodes.has(fromNodeId)) continue;
    const next = ordered[index + 1];
    const then: RecipeTarget = next
      ? { kind: "node", nodeId: compiledIds.get(next.id)! }
      : { kind: "terminal", status: "success" };
    transitions.push(CompiledRecipeTransitionSchema.parse({
      id: transitionId(recipe.recipeId, `auto-${source.id}`),
      fromNodeId,
      predicate: next
        ? { kind: "node_status", nodeId: fromNodeId, status: "passed" }
        : successPredicate,
      then,
      otherwise: { kind: "terminal", status: "failure" },
    }));
    if (transitions.length > policy.maxTransitions) return;
  }
}

export function compileCapabilityRecipe(
  value: unknown,
  options: CompileCapabilityRecipeOptions,
): RecipeCompilationResult {
  const parsed = parseRecipe(value);
  if (!parsed.recipe) return { ok: false, diagnostics: parsed.diagnostics };
  const recipe = parsed.recipe;
  const policy = RecipeExecutionPolicySchema.parse(options.policy ?? DEFAULT_RECIPE_EXECUTION_POLICY);
  const contextParsed = RecipeContextSchema.safeParse({
    projectId: options.context.projectId,
    rootPath: options.context.rootPath,
    revision: options.context.revision,
    operation: options.context.operation,
    scope: options.context.scope,
  });
  if (!contextParsed.success) {
    return {
      ok: false,
      diagnostics: contextParsed.error.issues.map((issue) =>
        diagnostic("RECIPE_INVALID", `context.${issue.path.join(".")}`, issue.message)),
    };
  }
  const context: RecipeCompilationContext = {
    ...options.context,
    operation: contextParsed.data.operation,
    scope: contextParsed.data.scope,
  };
  const operation = context.operation ?? contextParsed.data.operation;
  const scope = context.scope ?? contextParsed.data.scope;
  const diagnostics: RecipeCompilationDiagnostic[] = [];
  if (recipe.recipeVersion !== 1) {
    diagnostics.push(diagnostic("RECIPE_VERSION_UNSUPPORTED", "recipeVersion", "Only recipe version 1 is supported."));
  }
  if (recipe.nodes.length > policy.maxNodes) {
    diagnostics.push(diagnostic("RECIPE_TOO_LARGE", "nodes", `At most ${policy.maxNodes} nodes are allowed.`));
  }
  if (hasControlKey(value)) {
    diagnostics.push(diagnostic("RECIPE_INVALID", "$", "Recipe input contains a server-owned execution control."));
  }

  const byId = new Map<string, CapabilityRecipeNode>();
  for (const [index, source] of recipe.nodes.entries()) {
    if (byId.has(source.id)) {
      diagnostics.push(diagnostic("DUPLICATE_NODE_ID", `nodes[${index}].id`, `Node "${source.id}" is declared more than once.`));
    } else {
      byId.set(source.id, source);
    }
  }
  const ids = new Set(byId.keys());
  const ordered = topologicalOrder([...byId.values()], ids, diagnostics);
  const compiledIds = new Map(ordered.map((source) => [source.id, nodeId(recipe.recipeId, source.id)]));

  for (const [index, source] of recipe.nodes.entries()) {
    const adapter = options.registry.get(source.capabilityId);
    const validation = options.registry.validateInput(source.capabilityId, source.recipeVersion, source.input);
    if (!adapter) {
      diagnostics.push(diagnostic("CAPABILITY_UNKNOWN_ID", `nodes[${index}].capabilityId`, "The capability ID is not registered."));
      continue;
    }
    if (!validation.ok) {
      diagnostics.push(diagnostic(safeFailureCode(validation), `nodes[${index}]`, validation.detail));
    }
    if (!adapter.policy.allowedOperations.includes(operation)) {
      diagnostics.push(diagnostic("CAPABILITY_OPERATION_NOT_ALLOWED", `nodes[${index}].capabilityId`, "The capability is not approved for this operation."));
    }
    if (adapter.policy.requiresApproval && context.approvalState !== "APPROVED") {
      diagnostics.push(diagnostic("CAPABILITY_APPROVAL_REQUIRED", `nodes[${index}].capabilityId`, "The capability requires server approval."));
    }
    if (adapter.policy.approvedCommandProfiles.some((profile) => !context.approvedCommandProfiles?.has(profile))) {
      diagnostics.push(diagnostic("CAPABILITY_PROFILE_NOT_APPROVED", `nodes[${index}].capabilityId`, "The capability requires an approved command profile."));
    }
    if (adapter.catalog?.requiresAuthorization && context.authorized !== true) {
      diagnostics.push(diagnostic("CAPABILITY_AUTHORIZATION_REQUIRED", `nodes[${index}].capabilityId`, "The capability requires server authorization."));
    }
    if (context.maxRisk && RISK_ORDER.indexOf(adapter.policy.risk) > RISK_ORDER.indexOf(context.maxRisk)) {
      diagnostics.push(diagnostic("CAPABILITY_RISK_NOT_ALLOWED", `nodes[${index}].capabilityId`, "The capability risk exceeds the server budget."));
    }
    if (adapter.catalog && !adapter.catalog.supportedScopes.includes(scope.kind)) {
      diagnostics.push(diagnostic("CAPABILITY_SCOPE_UNSUPPORTED", `nodes[${index}].scope`, "The capability does not support the requested scope."));
    }
  }

  const mappedOutcome = {
    ...recipe.outcome,
    success: mapPredicate(recipe.outcome.success, byId, compiledIds, diagnostics, "outcome.success"),
    outputs: recipe.outcome.outputs.map((output, index) => {
      const source = byId.get(output.nodeId);
      if (!source) {
        diagnostics.push(diagnostic("UNKNOWN_TRANSITION_NODE", `outcome.outputs[${index}].nodeId`, `Node "${output.nodeId}" is not declared.`));
      } else if (!source.declaredOutputs.includes(output.output)) {
        diagnostics.push(diagnostic("UNDECLARED_OUTPUT", `outcome.outputs[${index}].output`, `Output "${output.output}" is not declared by node "${output.nodeId}".`));
      }
      return { ...output, nodeId: compiledIds.get(output.nodeId) ?? nodeId("invalid", output.nodeId) };
    }),
  };
  if (predicateDepth(recipe.outcome.success) > policy.maxPredicateDepth) {
    diagnostics.push(diagnostic("PREDICATE_TOO_DEEP", "outcome.success", `Predicates may be at most ${policy.maxPredicateDepth} levels deep.`));
  }
  if (findContradiction(recipe.outcome.success)) {
    diagnostics.push(diagnostic("CONTRADICTORY_PREDICATE", "outcome.success", "The success predicate is contradictory."));
  }

  const compiledTransitions: CompiledRecipeTransition[] = [];
  const transitionIds = new Set<string>();
  for (const [index, transition] of recipe.transitions.entries()) {
    if (transitionIds.has(transition.id)) {
      diagnostics.push(diagnostic("DUPLICATE_TRANSITION_ID", `transitions[${index}].id`, `Transition "${transition.id}" is declared more than once.`));
      continue;
    }
    transitionIds.add(transition.id);
    const fromNodeId = compiledIds.get(transition.fromNodeId);
    if (!fromNodeId) {
      diagnostics.push(diagnostic("UNKNOWN_TRANSITION_NODE", `transitions[${index}].fromNodeId`, `Node "${transition.fromNodeId}" is not declared.`));
      continue;
    }
    if (predicateDepth(transition.predicate) > policy.maxPredicateDepth) {
      diagnostics.push(diagnostic("PREDICATE_TOO_DEEP", `transitions[${index}].predicate`, `Predicates may be at most ${policy.maxPredicateDepth} levels deep.`));
    }
    if (findContradiction(transition.predicate)) {
      diagnostics.push(diagnostic("CONTRADICTORY_PREDICATE", `transitions[${index}].predicate`, "The transition predicate is contradictory."));
    }
    const predicate = mapPredicate(transition.predicate, byId, compiledIds, diagnostics, `transitions[${index}].predicate`);
    compiledTransitions.push(CompiledRecipeTransitionSchema.parse({
      id: transitionId(recipe.recipeId, transition.id),
      fromNodeId,
      predicate,
      then: mapTarget(transition.then, compiledIds, diagnostics, `transitions[${index}].then`),
      otherwise: mapTarget(transition.otherwise, compiledIds, diagnostics, `transitions[${index}].otherwise`),
    }));
  }
  addAutomaticTransitions(recipe, ordered, compiledIds, compiledTransitions, policy, mappedOutcome.success);
  const compiledTransitionIds = new Set<string>();
  for (const [index, transition] of compiledTransitions.entries()) {
    if (compiledTransitionIds.has(transition.id)) {
      diagnostics.push(diagnostic("DUPLICATE_TRANSITION_ID", `transitions[${index}].id`, `Compiled transition "${transition.id}" is not unique.`));
    }
    compiledTransitionIds.add(transition.id);
  }
  const branchesByNode = new Map<string, number>();
  for (const transition of compiledTransitions) {
    branchesByNode.set(transition.fromNodeId, (branchesByNode.get(transition.fromNodeId) ?? 0) + 1);
  }
  for (const [from, count] of branchesByNode) {
    if (count > policy.maxBranchesPerNode) {
      diagnostics.push(diagnostic("TOO_MANY_BRANCHES", from, `At most ${policy.maxBranchesPerNode} transitions may leave a node.`));
    }
  }
  if (compiledTransitions.length > policy.maxTransitions) {
    diagnostics.push(diagnostic("PLAN_TOO_LARGE", "transitions", `At most ${policy.maxTransitions} transitions are allowed.`));
  }
  if (graphHasCycle(compiledTransitions)) {
    diagnostics.push(diagnostic("NON_TERMINATING_PLAN", "transitions", "Compiled transitions must terminate and may not contain cycles."));
  }

  const nodes = ordered.map((source) => buildNode(recipe, source, compiledIds, context, policy));
  if (!everyNodeCanTerminate(nodes, compiledTransitions)) {
    diagnostics.push(diagnostic("NON_TERMINATING_PLAN", "transitions", "Every node must have a bounded path to a terminal outcome."));
  }
  const hasDependencyDiagnostic = diagnostics.some((item) =>
    item.code === "UNKNOWN_DEPENDENCY" || item.code === "DEPENDENCY_CYCLE");
  if (ordered.length * policy.nodeTimeoutMs > policy.maxTotalTimeoutMs) {
    diagnostics.push(diagnostic(
      "PLAN_TOO_LARGE",
      "nodes",
      `The node timeout budget exceeds the ${policy.maxTotalTimeoutMs} ms plan limit.`,
    ));
  }
  const reachable = new Set(ordered.filter((node) => node.dependsOn.length === 0).map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of ordered) {
      if (reachable.has(node.id)) continue;
      if (node.dependsOn.some((dependency) => reachable.has(dependency))) {
        reachable.add(node.id);
        changed = true;
      }
    }
  }
  if (!hasDependencyDiagnostic) {
    for (const node of ordered) {
      if (!reachable.has(node.id)) {
        diagnostics.push(diagnostic("UNREACHABLE_NODE", `nodes.${node.id}`, "Node is not reachable from a dependency root."));
      }
    }
  }
  if (!ValidationProfileSchema.safeParse(context.validationProfile ?? "workspace-typecheck").success) {
    diagnostics.push(diagnostic("INVALID_VALIDATION_PROFILE", "context.validationProfile", "The server validation profile is not registered."));
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const recipeContext = RecipeContextSchema.parse({
    projectId: context.projectId,
    rootPath: context.rootPath,
    revision: context.revision,
    operation,
    scope,
  });
  const recipeState: RecipeState = RecipeStateSchema.parse({
    status: "pending",
    currentNodeId: nodes[0]?.id ?? null,
    completedNodeIds: [],
    outputs: {},
  });
  return {
    ok: true,
    plan: ActiveTaskExecutionPlanSchema.parse({
      phases: [],
      claims: [],
      boundaries: {
        projectId: context.projectId,
        rootPath: context.rootPath,
        allowedWriteFiles: [...new Set((context.allowedFiles ?? []).map(normalizedPath).filter(Boolean))].slice(0, 48),
        sourceRoots: [],
        verdictScopes: [],
        revision: context.revision,
      },
      nodes,
      readiness: "READY",
      implementationPlan: null,
      currentStepIndex: 0,
      planFingerprint: null,
      stepFingerprint: null,
      planningAttempts: 1,
      recipe,
      outcomeContract: mappedOutcome,
      transitions: compiledTransitions,
      executionPolicy: policy,
      recipeContext,
      recipeState,
    }),
  };
}

export function compileCapabilityRecipeOrThrow(
  value: unknown,
  options: CompileCapabilityRecipeOptions,
): ActiveTaskExecutionPlan {
  const result = compileCapabilityRecipe(value, options);
  if (!result.ok) throw new RecipeCompilationError(result.diagnostics);
  return result.plan;
}

export const compileSafeRecipe = compileCapabilityRecipe;
export const compileRecipe = compileCapabilityRecipe;

function readPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function evaluatePredicate(
  predicate: EvidencePredicate,
  evidence: RecipeEvidence,
): boolean | undefined {
  const node = evidence[predicate.kind === "all" || predicate.kind === "any"
    ? ""
    : predicate.kind === "not" ? "" : predicate.nodeId];
  if (predicate.kind === "all") {
    const values = predicate.predicates.map((child) => evaluatePredicate(child, evidence));
    if (values.some((value) => value === false)) return false;
    return values.every((value) => value === true) ? true : undefined;
  }
  if (predicate.kind === "any") {
    const values = predicate.predicates.map((child) => evaluatePredicate(child, evidence));
    if (values.some((value) => value === true)) return true;
    return values.every((value) => value === false) ? false : undefined;
  }
  if (predicate.kind === "not") {
    const value = evaluatePredicate(predicate.predicate, evidence);
    return value === undefined ? undefined : !value;
  }
  if (!node) return undefined;
  if (predicate.kind === "node_status") return node.status === predicate.status;
  if (predicate.kind === "output_present") {
    return node.outputs ? Object.prototype.hasOwnProperty.call(node.outputs, predicate.output) : undefined;
  }
  if (predicate.kind === "output_equals") {
    if (!node.outputs || !Object.prototype.hasOwnProperty.call(node.outputs, predicate.output)) return undefined;
    return JSON.stringify(readPath(node.outputs, predicate.output)) === JSON.stringify(predicate.value);
  }
  return node.evidence?.some((item) => item.type === predicate.evidenceType) ?? undefined;
}

export function evaluateRecipeEvidencePredicate(
  predicate: EvidencePredicate,
  evidence: RecipeEvidence,
): boolean | undefined {
  const parsed = CompiledEvidencePredicateSchema.safeParse(predicate);
  return parsed.success ? evaluatePredicate(parsed.data, evidence) : undefined;
}

export type RecipeTransitionAdvanceResult = {
  status: "advanced" | "succeeded" | "failed" | "blocked" | "cancelled";
  state: RecipeState;
  transition?: CompiledRecipeTransition;
};

export function advanceCompiledRecipeTransition(
  plan: ActiveTaskExecutionPlan,
  evidence: RecipeEvidence,
  signal?: AbortSignal,
): RecipeTransitionAdvanceResult {
  const state = RecipeStateSchema.parse(plan.recipeState ?? {
    status: "pending",
    currentNodeId: plan.nodes[0]?.id ?? null,
    completedNodeIds: [],
    outputs: {},
  });
  if (signal?.aborted) return { status: "cancelled", state: { ...state, status: "cancelled" } };
  if (state.status === "succeeded" || state.status === "failed" || state.status === "cancelled") {
    return { status: state.status, state };
  }
  if (!state.currentNodeId) return { status: "blocked", state };
  const candidates = (plan.transitions ?? []).filter((transition) => transition.fromNodeId === state.currentNodeId);
  for (const transition of candidates) {
    const result = evaluateRecipeEvidencePredicate(transition.predicate, evidence);
    if (result === undefined) return { status: "blocked", state: { ...state, status: "running" } };
    const target = result ? transition.then : transition.otherwise;
    if (target.kind === "terminal") {
      if (target.status === "success" && plan.outcomeContract) {
        const outcome = evaluateRecipeEvidencePredicate(plan.outcomeContract.success, evidence);
        if (outcome === undefined) {
          return { status: "blocked", state: { ...state, status: "running" }, transition };
        }
        if (!outcome) {
          const failedState = RecipeStateSchema.parse({
            ...state,
            status: "failed",
            currentNodeId: null,
            completedNodeIds: state.completedNodeIds.includes(state.currentNodeId)
              ? state.completedNodeIds
              : [...state.completedNodeIds, state.currentNodeId],
          });
          return { status: "failed", state: failedState, transition };
        }
      }
      const nextState = RecipeStateSchema.parse({
        ...state,
        status: target.status === "success" ? "succeeded" : "failed",
        currentNodeId: null,
        completedNodeIds: state.completedNodeIds.includes(state.currentNodeId)
          ? state.completedNodeIds
          : [...state.completedNodeIds, state.currentNodeId],
      });
      return {
        status: target.status === "success" ? "succeeded" : "failed",
        state: nextState,
        transition,
      };
    }
    const nextState = RecipeStateSchema.parse({
      ...state,
      status: "running",
      currentNodeId: target.nodeId,
      completedNodeIds: state.completedNodeIds.includes(state.currentNodeId)
        ? state.completedNodeIds
        : [...state.completedNodeIds, state.currentNodeId],
    });
    return { status: "advanced", state: nextState, transition };
  }
  return { status: "blocked", state: { ...state, status: "running" } };
}