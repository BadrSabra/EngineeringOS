import { describe, expect, it } from "vitest";
import {
  RecipeDefinitionRegistry,
  createServerRecipeDefinitionRegistry,
} from "../recipe-definition-registry.js";

describe("server recipe definition registry", () => {
  it("registers deterministic server-owned baseline recipes", () => {
    const registry = createServerRecipeDefinitionRegistry();
    expect(registry.listIds()).toEqual([
      "browser.verify",
      "candidate.verify",
      "validation.recover",
    ]);
    expect(registry.resolve("candidate.verify", 1)).toMatchObject({
      recipeId: "candidate.verify",
      recipeVersion: 1,
      maxParallelNodes: 1,
      executionPolicy: { maxAttempts: 2, maxTotalTimeoutMs: 900_000 },
    });
  });

  it("builds only the registered graph from bounded business inputs", () => {
    const registry = createServerRecipeDefinitionRegistry();
    const recipe = registry.build({
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
      candidateIdentity: "candidate-1",
    });
    expect(recipe.nodes).toHaveLength(2);
    expect(recipe.nodes[0]).toMatchObject({
      capabilityId: "validation.run.workspace-typecheck",
      input: { targetPaths: ["lib/ai-orchestrator/src/index.ts"] },
    });
    expect(recipe.nodes[1]).toMatchObject({
      capabilityId: "validation.run.ai-orchestrator-tests",
      dependsOn: ["workspace-typecheck"],
    });
    expect(recipe.nodes[0]).not.toHaveProperty("timeoutMs");
  });

  it("rejects unknown IDs and model-supplied graph controls", () => {
    const registry = createServerRecipeDefinitionRegistry();
    expect(registry.resolve("missing.recipe", 1)).toBeUndefined();
    expect(() => registry.build({
      recipeId: "missing.recipe",
      recipeVersion: 1,
      approvedPaths: [],
      nodes: [],
    })).toThrow(/unrecognized_keys/);
  });

  it("rejects duplicate registrations", () => {
    const registry = new RecipeDefinitionRegistry();
    const definition = createServerRecipeDefinitionRegistry().resolve("browser.verify", 1)!;
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow(/already registered/);
  });
});