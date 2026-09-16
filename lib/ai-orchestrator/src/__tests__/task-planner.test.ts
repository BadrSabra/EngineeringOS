import { describe, expect, it } from "vitest";
import { buildGeneralTaskPlan, canReuseTaskPlanRevision } from "../task-planner.js";

function intent(overrides: Partial<Parameters<typeof buildGeneralTaskPlan>[0]["turnIntent"]> = {}) {
  return {
    kind: "PROJECT_QUERY" as const,
    executionTaskType: "tool_chat" as const,
    requiresTools: true,
    requiresEvidence: true,
    allowsBuildHandoff: false,
    ...overrides,
  };
}

describe("buildGeneralTaskPlan", () => {
  it("creates one canonical inspect/analyze/deliver plan for a new project query", () => {
    const plan = buildGeneralTaskPlan({
      message: "Explain the embedded AI agent",
      turnIntent: intent(),
    });

    expect(plan.decision).toBe("CREATE");
    expect(plan.source).toBe("new");
    expect(plan.skipQueryPlanner).toBe(false);
    expect(plan.steps.map((step) => step.kind)).toEqual(["inspect", "analyze", "deliver"]);
    expect(plan.steps[1]?.dependencies).toEqual(["inspect"]);
  });

  it("creates a functional orientation plan for broad explain-project requests", () => {
    const plan = buildGeneralTaskPlan({
      message: "Explain the project",
      turnIntent: intent({ requiresEvidence: false }),
      projectOrientation: true,
    });

    expect(plan.profile).toBe("project_orientation");
    expect(plan.decision).toBe("CREATE");
    expect(plan.steps.map((step) => step.id)).toEqual([
      "discover-purpose",
      "map-components",
      "trace-primary-flow",
      "verify-orientation",
      "deliver",
    ]);
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "inspect",
      "analyze",
      "analyze",
      "validate",
      "deliver",
    ]);
    expect(plan.steps[2]?.dependencies).toEqual(["map-components"]);
    expect(plan.steps[3]?.readOnly).toBe(true);
    expect(plan.steps[4]?.dependencies).toEqual(["verify-orientation"]);
    expect(plan.orientationCoverage).toEqual({
      purpose: "required",
      components: "required",
      primaryFlow: "required",
      uncertainty: "required",
    });
  });

  it("reuses an existing durable execution plan and suppresses duplicate query planning", () => {
    const existing = {
      phases: [],
      claims: [],
      boundaries: {
        projectId: "project-1",
        rootPath: "/workspace/project-1",
        allowedWriteFiles: ["src/example.ts"],
        sourceRoots: ["src"],
        verdictScopes: [],
      },
      nodes: [{
        id: "node-1",
        title: "Inspect source",
        status: "queued" as const,
        allowedFiles: ["src/example.ts"],
        dependencies: [],
        validationProfile: "workspace-typecheck" as const,
        attempts: 0,
        validationAttempts: 0,
      }],
      readiness: "READY" as const,
      implementationPlan: null,
      currentStepIndex: 0,
      planFingerprint: "a".repeat(64),
      stepFingerprint: null,
      planningAttempts: 1,
      recipe: null,
      outcomeContract: null,
      transitions: [],
      executionPolicy: null,
      recipeContext: null,
      recipeState: null,
    };

    const plan = buildGeneralTaskPlan({
      message: "Continue",
      turnIntent: intent({
        kind: "DELIVERY",
        executionTaskType: "task_execution",
        requiresEvidence: false,
        allowsBuildHandoff: true,
      }),
      existingExecutionPlan: existing,
      existingQueryPlan: {
        originalIntent: "old",
        targetFiles: ["src/old.ts"],
        targetEntities: [],
        scopeEstimate: "narrow",
        suggestedIterations: 8,
        requiresToolUse: true,
        subQueries: [],
        compoundParts: [],
      },
    });

    expect(plan.decision).toBe("REUSE");
    expect(plan.source).toBe("execution_plan");
    expect(plan.skipQueryPlanner).toBe(true);
    expect(plan.reusedPlanFingerprint).toBe("a".repeat(64));
    expect(plan.conflicts).toContain("existing query plan is superseded by the durable execution plan");
  });

  it("reuses persisted project-query scope before creating another provider plan", () => {
    const plan = buildGeneralTaskPlan({
      message: "Explain the next step",
      turnIntent: intent(),
      existingProjectQuery: {
        requiredEvidencePaths: ["src/agent.ts", "./src/router.ts"],
        requiredClaims: [{ claimId: "routing" }, { claimId: "acceptance" }],
      },
    });

    expect(plan.decision).toBe("REUSE");
    expect(plan.source).toBe("project_query_state");
    expect(plan.skipQueryPlanner).toBe(true);
    expect(plan.steps[0]?.files).toEqual(["src/agent.ts", "src/router.ts"]);
    expect(plan.steps.map((step) => step.kind)).toEqual(["inspect", "analyze", "deliver"]);
  });

  it("rejects a persisted plan from an older revision unless the server supplied an override", () => {
    expect(canReuseTaskPlanRevision({
      persistedRevision: "rev-old",
      currentRevision: "rev-new",
    })).toBe(false);
    expect(canReuseTaskPlanRevision({
      persistedRevision: "rev-old",
      currentRevision: undefined,
    })).toBe(false);
    expect(canReuseTaskPlanRevision({
      persistedRevision: "rev-old",
      currentRevision: "rev-new",
      explicitOverride: true,
    })).toBe(true);
  });

  it("keeps approval on the execution boundary for a newly created delivery plan", () => {
    const plan = buildGeneralTaskPlan({
      message: "Apply the approved fix",
      turnIntent: intent({
        kind: "DELIVERY",
        executionTaskType: "task_execution",
        requiresEvidence: false,
        allowsBuildHandoff: false,
      }),
    });

    const execute = plan.steps.find((step) => step.kind === "execute");
    expect(execute?.approvalRequired).toBe(true);
    expect(execute?.readOnly).toBe(false);
  });
});