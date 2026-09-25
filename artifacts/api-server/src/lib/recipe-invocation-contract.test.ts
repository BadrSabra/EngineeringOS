import { describe, expect, it } from "vitest";
import type { ActiveTaskExecutionPlan } from "@workspace/ai-orchestrator";
import {
  buildRecipeReadOnlyInvocationContract,
  isReadOnlyRecipeCapability,
} from "./recipe-invocation-contract.js";

function invocationNode(
  overrides: Partial<ActiveTaskExecutionPlan["nodes"][number]> = {},
): ActiveTaskExecutionPlan["nodes"][number] {
  return {
    id: "read-project-data",
    title: "Read the approved project data view",
    status: "queued",
    validationProfile: "workspace-typecheck",
    allowedFiles: [],
    dependencies: [],
    capabilityId: "database.read_project",
    recipeVersion: 1,
    capabilityInput: { resource: "project_summary", limit: 1 },
    executionContext: {
      projectId: "project-1",
      operation: "recipe",
      scope: { kind: "project", paths: [] },
      rootPath: null,
      revision: "source-revision-1",
    },
    ...overrides,
  } as ActiveTaskExecutionPlan["nodes"][number];
}

describe("recipe read-only invocation contract", () => {
  it("binds stable identity, scope, revision, and hashed input", () => {
    const input = {
      episodeId: "episode-1",
      executionId: "execution-1",
      executionAttempt: 2,
      node: invocationNode(),
      nodeAttempt: 3,
      projectId: "project-1",
      projectRevision: "source-revision-1",
    };
    const contract = buildRecipeReadOnlyInvocationContract(input);

    expect(contract).toMatchObject({
      contractVersion: 1,
      recordKind: "recipe_capability_invocation",
      nodeId: "read-project-data",
      nodeAttempt: 3,
      capabilityId: "database.read_project",
      recipeVersion: 1,
      projectRevision: "source-revision-1",
      capabilityRevision: "source-revision-1",
      scope: { kind: "project", paths: [] },
      invocationId: expect.stringMatching(/^[a-f0-9]{64}$/),
      scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(contract)).not.toContain("project_summary");
    expect(
      buildRecipeReadOnlyInvocationContract({
        ...input,
        nodeAttempt: 4,
      })?.invocationId,
    ).not.toBe(contract?.invocationId);
  });

  it("supports the registered project-data reader and rejects effectful or unknown capabilities", () => {
    expect(isReadOnlyRecipeCapability("database.read_project")).toBe(true);
    expect(isReadOnlyRecipeCapability("project.read_file")).toBe(false);
    expect(isReadOnlyRecipeCapability("runtime.start")).toBe(false);
    expect(isReadOnlyRecipeCapability("github.push_verified_commit")).toBe(false);
    expect(isReadOnlyRecipeCapability("validation.run.workspace-typecheck")).toBe(false);
    expect(isReadOnlyRecipeCapability("unknown.capability")).toBe(false);
  });

  it("fails closed when the server-owned scope or revision is missing", () => {
    expect(buildRecipeReadOnlyInvocationContract({
      episodeId: "episode-1",
      executionId: "execution-1",
      executionAttempt: 1,
      node: {
        ...invocationNode(),
        executionContext: {
          projectId: "project-1",
          operation: "recipe",
          scope: undefined,
          rootPath: null,
          revision: "source-revision-1",
        },
      } as unknown as ActiveTaskExecutionPlan["nodes"][number],
      nodeAttempt: 1,
      projectId: "project-1",
      projectRevision: "source-revision-1",
    })).toBeUndefined();
    expect(buildRecipeReadOnlyInvocationContract({
      episodeId: "episode-1",
      executionId: "execution-1",
      executionAttempt: 1,
      node: {
        ...invocationNode(),
        executionContext: {
          projectId: "project-1",
          operation: "recipe",
          scope: { kind: "file", paths: ["src/index.ts"] },
          rootPath: null,
          revision: undefined,
        },
      } as unknown as ActiveTaskExecutionPlan["nodes"][number],
      nodeAttempt: 1,
      projectId: "project-1",
      projectRevision: "source-revision-1",
    })).toBeUndefined();
  });
});