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
  maxRisk: "low" | "medium" | "high" | "critical";
  buildRecipe: (request: RecipeRequest) => CapabilityRecipe;
};

function targetPaths(request: RecipeRequest): string[] {
  return [...request.approvedPaths];
}

function validationProfiles(request: RecipeRequest): Array<"workspace-typecheck" | "ai-orchestrator-tests"> {
  return request.validationProfiles?.length
    ? [...new Set(request.validationProfiles)]
    : ["workspace-typecheck", "ai-orchestrator-tests"];
}

function definition(
  recipeId: string,
  nodes: (request: RecipeRequest) => CapabilityRecipe["nodes"],
  outcome: CapabilityRecipe["outcome"] | ((request: RecipeRequest) => CapabilityRecipe["outcome"]),
  executionPolicy: RecipeExecutionPolicy,
  maxParallelNodes = 1,
  maxRisk: RecipeDefinition["maxRisk"] = "low",
): RecipeDefinition {
  const buildRecipe = (request: RecipeRequest): CapabilityRecipe => ({
    contractVersion: RECIPE_CONTRACT_VERSION,
    recipeId,
    recipeVersion: request.recipeVersion,
    nodes: nodes(request),
    transitions: [],
    outcome: typeof outcome === "function" ? outcome(request) : outcome,
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
    outcome: sample.outcome,
    executionPolicy,
    maxParallelNodes,
    maxRisk,
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

const RUNTIME_POLICY: RecipeExecutionPolicy = {
  ...DEFAULT_RECIPE_EXECUTION_POLICY,
  maxAttempts: 1,
  nodeTimeoutMs: 120_000,
  maxTotalTimeoutMs: 180_000,
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
        ...validationProfiles(request).map((profile, index) => ({
          id: profile === "workspace-typecheck" ? "workspace-typecheck" : "focused-validation",
          title: profile === "workspace-typecheck"
            ? "Typecheck the candidate workspace"
            : "Run focused candidate validation",
          capabilityId: `validation.run.${profile}`,
          recipeVersion: 1,
          input: { targetPaths: targetPaths(request) },
          dependsOn: index === 0
            ? []
            : [validationProfiles(request)[index - 1] === "workspace-typecheck"
              ? "workspace-typecheck"
              : "focused-validation"],
          declaredOutputs: ["status", "evidence"],
        })),
      ],
      (request) => ({
        success: {
          kind: "all",
          predicates: [
            ...validationProfiles(request).map((profile) => ({
              kind: "node_status" as const,
              nodeId: profile === "workspace-typecheck" ? "workspace-typecheck" : "focused-validation",
              status: "passed" as const,
            })),
            {
              kind: "evidence" as const,
              nodeId: validationProfiles(request).at(-1) === "workspace-typecheck"
                ? "workspace-typecheck"
                : "focused-validation",
              evidenceType: "validation_passed" as const,
            },
          ],
        },
        outputs: [],
      }),
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
    definition(
      "runtime.start",
      () => [{
        id: "runtime-start",
        title: "Start and verify the server-owned workspace runtime",
        capabilityId: "runtime.start",
        recipeVersion: 1,
        input: {},
        dependsOn: [],
        declaredOutputs: ["status", "profile", "evidence"],
      }],
      {
        success: {
          kind: "evidence",
          nodeId: "runtime-start",
          evidenceType: "runtime_verified",
        },
        outputs: [],
      },
      RUNTIME_POLICY,
      1,
      "high",
    ),
    ...(["restart", "stop"] as const).map((mode) => definition(
      `runtime.${mode}`,
      () => [{
        id: `runtime-${mode}`,
        title: `${mode === "restart" ? "Restart" : "Stop"} and verify the server-owned workspace runtime`,
        capabilityId: `runtime.${mode}`,
        recipeVersion: 1,
        input: {},
        dependsOn: [],
        declaredOutputs: ["status", "profile", "evidence"],
      }],
      {
        success: {
          kind: "evidence",
          nodeId: `runtime-${mode}`,
          evidenceType: "runtime_verified",
        },
        outputs: [],
      },
      RUNTIME_POLICY,
      1,
      "high",
    )),
    definition(
      "database.inspect.project",
      () => [{
        id: "read-project-data",
        title: "Read the approved project data view",
        capabilityId: "database.read_project",
        recipeVersion: 1,
        input: { resource: "project_summary", limit: 1 },
        dependsOn: [],
        declaredOutputs: ["status", "rows", "evidence"],
      }],
      {
        success: {
          kind: "evidence",
          nodeId: "read-project-data",
          evidenceType: "database_read",
        },
        outputs: [],
      },
      {
        ...DEFAULT_RECIPE_EXECUTION_POLICY,
        maxAttempts: 1,
        nodeTimeoutMs: 30_000,
        maxTotalTimeoutMs: 60_000,
      },
    ),
    definition(
      "delivery.push.github",
      (request) => [{
        id: "github-delivery",
        title: "Push the server-approved verified delivery to GitHub",
        capabilityId: "github.push_verified_commit",
        recipeVersion: 1,
        input: {
          message: request.deliveryMessage ?? "EngineeringOS verified delivery",
        },
        dependsOn: [],
        declaredOutputs: ["status", "evidence", "remoteCommitHash"],
      }],
      {
        success: {
          kind: "evidence",
          nodeId: "github-delivery",
          evidenceType: "integration_verified",
        },
        outputs: [],
      },
      {
        ...DEFAULT_RECIPE_EXECUTION_POLICY,
        maxAttempts: 1,
        nodeTimeoutMs: 120_000,
        maxTotalTimeoutMs: 300_000,
      },
      1,
      "critical",
    ),
  ]);
}