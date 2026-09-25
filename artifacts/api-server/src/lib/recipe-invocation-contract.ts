import {
  canonicalJsonHash,
  type ActiveTaskExecutionPlan,
  type JsonValue,
} from "@workspace/ai-orchestrator";

// Add IDs only when both execution and output/evidence semantics are read-only.
const READ_ONLY_RECIPE_CAPABILITIES = new Set(["database.read_project"]);

export type RecipeReadOnlyInvocationContract = {
  contractVersion: 1;
  recordKind: "recipe_capability_invocation";
  invocationId: string;
  nodeId: string;
  nodeAttempt: number;
  capabilityId: string;
  recipeVersion: number;
  projectRevision: string;
  capabilityRevision: string;
  scope: JsonValue;
  scopeHash: string;
  inputHash: string;
};

export function isReadOnlyRecipeCapability(
  capabilityId: string | null | undefined,
): boolean {
  return typeof capabilityId === "string"
    && READ_ONLY_RECIPE_CAPABILITIES.has(capabilityId);
}

export function hashJsonValue(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return canonicalJsonHash(JSON.parse(serialized) as JsonValue);
  } catch {
    return undefined;
  }
}

export function buildRecipeReadOnlyInvocationContract(input: {
  episodeId: string;
  executionId: string;
  executionAttempt: number;
  node: ActiveTaskExecutionPlan["nodes"][number];
  nodeAttempt: number;
  projectId: string;
  projectRevision: string;
}): RecipeReadOnlyInvocationContract | undefined {
  const { node } = input;
  const capabilityId = node.capabilityId;
  const scope = node.executionContext?.scope;
  const capabilityRevision = node.executionContext?.revision;
  if (
    typeof capabilityId !== "string"
    || !isReadOnlyRecipeCapability(capabilityId)
    || node.recipeVersion === undefined
    || scope === undefined
    || typeof capabilityRevision !== "string"
  ) {
    return undefined;
  }
  const inputHash = hashJsonValue(node.capabilityInput);
  if (!inputHash) return undefined;
  return {
    contractVersion: 1,
    recordKind: "recipe_capability_invocation",
    invocationId: canonicalJsonHash({
      episodeId: input.episodeId,
      projectId: input.projectId,
      executionId: input.executionId,
      executionAttempt: input.executionAttempt,
      nodeId: node.id,
      nodeAttempt: input.nodeAttempt,
      capabilityId,
      recipeVersion: node.recipeVersion,
    }),
    nodeId: node.id,
    nodeAttempt: input.nodeAttempt,
    capabilityId,
    recipeVersion: node.recipeVersion,
    projectRevision: input.projectRevision,
    capabilityRevision,
    scope: scope as JsonValue,
    scopeHash: canonicalJsonHash(scope),
    inputHash,
  };
}