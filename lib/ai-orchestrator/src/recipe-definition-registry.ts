import {
  RecipeIdSchema,
  RecipeRequestSchema,
  RECIPE_CONTRACT_VERSION,
  type CapabilityRecipe,
  type RecipeRequest,
} from "./recipe-contract.js";
import {
  DEFAULT_RECIPE_EXECUTION_POLICY,
} from "./recipe-compiler.js";
import type { RecipeExecutionPolicy } from "./recipe-contract.js";

export type RecipeDefinition = {
  contractVersion: typeof RECIPE_CONTRACT_VERSION;
  recipeId: string;
  recipeVersion: number;
  nodes: readonly CapabilityRecipe["nodes"][number][];
  transitions: readonly CapabilityRecipe["transitions"][number][];
  outcome: CapabilityRecipe["outcome"];
  executionPolicy: RecipeExecutionPolicy;
  maxParallelNodes: number;
  buildRecipe: (request: RecipeRequest) => CapabilityRecipe;
};

function targetPaths(request: RecipeRequest): string[] {
  return [...request.approvedPaths];
}

function definition(
  recipeId: string,
  nodes: (request: RecipeRequest) => CapabilityRecipe["nodes"],
  outcome: CapabilityRecipe["outcome"],
  executionPolicy: RecipeExecutionPolicy,
  maxParallelNodes = 1,
): RecipeDefinition {
  const buildRecipe = (request: RecipeRequest): CapabilityRecipe => ({
    contractVersion: RECIPE_CONTRACT_VERSION,
    recipeId,
    recipeVersion: request.recipeVersion,
    nodes: nodes(request),
    transitions: [],
    outcome,
  });
  const sample = buildRecipe({
    recipeId,
    recipeVersion: 1,
    approvedPaths: [],
    candidateIdentity: null,
  });
  return {
    contractVersion: RECIPE_CONTRACT_VERSION,
    recipeId,
    recipeVersion: 1,
    nodes: sample.nodes,
    transitions: sample.transitions,
    outcome,
    executionPolicy,
    maxParallelNodes,
    buildRecipe,
  };
}

const CANDIDATE_VERIFY_POLICY: RecipeExecutionPolicy = {
  ...DEFAULT_RECIPE_EXECUTION_POLICY,
  maxAttempts: 2,
  nodeTimeoutMs: 120_000,
  maxTotalTimeoutMs: 900_000,
};

const RECOVERY_POLICY: RecipeExecutionPolicy = {
  ...DEFAULT_RECIPE_EXECUTION_POLICY,
  maxAttempts: 1,
  nodeTimeoutMs: 120_000,
  maxTotalTimeoutMs: 120_000,
};

const BROWSER_POLICY: RecipeExecutionPolicy = {
  ...DEFAULT_RECIPE_EXECUTION_POLICY,
  maxAttempts: 2,
  nodeTimeoutMs: 60_000,
  maxTotalTimeoutMs: 120_000,
};

export class RecipeDefinitionRegistry {
  private readonly definitions = new Map<string, RecipeDefinition>();

  public constructor(definitions: readonly RecipeDefinition[] = []) {
    for (const item of definitions) this.register(item);
  }

  public register(definition: RecipeDefinition): void {
    const parsed = RecipeIdSchema.safeParse(definition.recipeId);
    if (!parsed.success || definition.contractVersion !== RECIPE_CONTRACT_VERSION) {
      throw new Error("Invalid server recipe definition.");
    }
    if (this.definitions.has(definition.recipeId)) {
      throw new Error(`Recipe definition "${definition.recipeId}" is already registered.`);
    }
    if (definition.recipeVersion !== 1 || definition.nodes.length < 1 || definition.nodes.length > definition.executionPolicy.maxNodes) {
      throw new Error(`Recipe definition "${definition.recipeId}" exceeds its server-owned plan policy.`);
    }
    if (!Number.isInteger(definition.maxParallelNodes)
      || definition.maxParallelNodes < 1
      || definition.maxParallelNodes > 8) {
      throw new Error(`Recipe definition "${definition.recipeId}" has invalid parallelism.`);
    }
    this.definitions.set(definition.recipeId, Object.freeze({
      ...definition,
      nodes: Object.freeze(definition.nodes.map((node) => Object.freeze({ ...node }))),
      transitions: Object.freeze([...definition.transitions]),
      executionPolicy: Object.freeze({ ...definition.executionPolicy }),
    }));
  }

  public resolve(recipeId: string, recipeVersion = 1): RecipeDefinition | undefined {
    const parsed = RecipeIdSchema.safeParse(recipeId);
    if (!parsed.success) return undefined;
    const found = this.definitions.get(parsed.data);
    return found?.recipeVersion === recipeVersion ? found : undefined;
  }

  public listIds(): readonly string[] {
    return [...this.definitions.keys()].sort();
  }

  public build(request: unknown): CapabilityRecipe {
    const parsed = RecipeRequestSchema.parse(request);
    const found = this.resolve(parsed.recipeId, parsed.recipeVersion);
    if (!found) throw new Error(`Unknown server recipe "${parsed.recipeId}" version ${parsed.recipeVersion}.`);
    return found.buildRecipe(parsed);
  }
}

export function createServerRecipeDefinitionRegistry(): RecipeDefinitionRegistry {
  return new RecipeDefinitionRegistry([
    definition(
      "candidate.verify",
      (request) => [
        {
          id: "workspace-typecheck",
          title: "Typecheck the candidate workspace",
          capabilityId: "validation.run.workspace-typecheck",
          recipeVersion: 1,
          input: { targetPaths: targetPaths(request) },
          dependsOn: [],
          declaredOutputs: ["status", "evidence"],
        },
        {
          id: "focused-validation",
          title: "Run focused candidate validation",
          capabilityId: "validation.run.ai-orchestrator-tests",
          recipeVersion: 1,
          input: { targetPaths: targetPaths(request) },
          dependsOn: ["workspace-typecheck"],
          declaredOutputs: ["status", "evidence"],
        },
      ],
      {
        success: {
          kind: "all",
          predicates: [
            { kind: "node_status", nodeId: "workspace-typecheck", status: "passed" },
            { kind: "node_status", nodeId: "focused-validation", status: "passed" },
            { kind: "evidence", nodeId: "focused-validation", evidenceType: "validation_passed" },
          ],
        },
        outputs: [],
      },
      CANDIDATE_VERIFY_POLICY,
    ),
    definition(
      "validation.recover",
      (request) => [{
        id: "recover-validation",
        title: "Rerun the registered validation profile",
        capabilityId: "validation.run.ai-orchestrator-tests",
        recipeVersion: 1,
        input: { targetPaths: targetPaths(request) },
        dependsOn: [],
        declaredOutputs: ["status", "evidence"],
      }],
      {
        success: {
          kind: "evidence",
          nodeId: "recover-validation",
          evidenceType: "validation_passed",
        },
        outputs: [],
      },
      RECOVERY_POLICY,
    ),
    definition(
      "browser.verify",
      (request) => [{
        id: "browser-verification",
        title: "Verify the approved browser profile",
        capabilityId: "browser.verify.default",
        recipeVersion: 1,
        input: { targetPaths: targetPaths(request) },
        dependsOn: [],
        declaredOutputs: ["status", "evidence"],
      }],
      {
        success: {
          kind: "evidence",
          nodeId: "browser-verification",
          evidenceType: "browser_verified",
        },
        outputs: [],
      },
      BROWSER_POLICY,
    ),
  ]);
}