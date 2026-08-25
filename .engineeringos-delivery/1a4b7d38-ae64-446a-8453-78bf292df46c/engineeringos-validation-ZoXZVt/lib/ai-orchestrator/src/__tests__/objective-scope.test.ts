import { describe, expect, it } from "vitest";
import {
  ObjectiveScopePolicySchema,
  classifyObjectiveScopePath,
} from "../objective-scope.js";

const policy = {
  primaryPaths: ["lib/knowledge-engine/src/inference.ts"],
  allowedExpansionPaths: [
    "lib/knowledge-engine/src/index.ts",
    "artifacts/api-server/src/routes/graph.ts",
  ],
  forbiddenPaths: [
    "lib/ai-orchestrator/src/__tests__",
    "benchmark-results",
  ],
};

describe("AI-OBJ-008: objective scope policy", () => {
  it("accepts primary target reads without emitting an expansion", () => {
    expect(classifyObjectiveScopePath("lib/knowledge-engine/src/inference.ts", policy)).toBeUndefined();
    expect(classifyObjectiveScopePath("./lib/knowledge-engine/src/inference.ts", policy)).toBeUndefined();
  });

  it("records caller/route reads as justified expansions", () => {
    expect(classifyObjectiveScopePath("lib/knowledge-engine/src/index.ts", policy)).toEqual({
      kind: "JUSTIFIED_SCOPE_EXPANSION",
      path: "lib/knowledge-engine/src/index.ts",
      matchedPolicyPath: "lib/knowledge-engine/src/index.ts",
    });
    expect(classifyObjectiveScopePath("artifacts/api-server/src/routes/graph.ts", policy)?.kind)
      .toBe("JUSTIFIED_SCOPE_EXPANSION");
  });

  it("rejects forbidden and unrelated paths as unjustified expansions", () => {
    expect(classifyObjectiveScopePath("lib/ai-orchestrator/src/__tests__/fixture.ts", policy)?.kind)
      .toBe("UNJUSTIFIED_SCOPE_EXPANSION");
    expect(classifyObjectiveScopePath("lib/other-package/src/index.ts", policy)?.kind)
      .toBe("UNJUSTIFIED_SCOPE_EXPANSION");
  });

  it("forbidden paths win even if a broad expansion path would otherwise match", () => {
    const broadPolicy = {
      ...policy,
      allowedExpansionPaths: ["lib"],
    };
    expect(classifyObjectiveScopePath("lib/ai-orchestrator/src/__tests__/fixture.ts", broadPolicy)?.kind)
      .toBe("UNJUSTIFIED_SCOPE_EXPANSION");
  });

  it("validates bounded objective policies", () => {
    expect(ObjectiveScopePolicySchema.safeParse(policy).success).toBe(true);
    expect(ObjectiveScopePolicySchema.safeParse({
      primaryPaths: [],
      allowedExpansionPaths: [],
      forbiddenPaths: [],
    }).success).toBe(true);
  });
});