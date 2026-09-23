import { describe, expect, it } from "vitest";
import { buildMissionPlanPreview } from "../mission-planning.js";

describe("buildMissionPlanPreview", () => {
  it("keeps low-risk conversational requests on the chat path", () => {
    const preview = buildMissionPlanPreview({
      message: "Hello, how are you?",
    });

    expect(preview.admission).toBe("chat");
    expect(preview.admissionReason).toBe("low_risk_chat");
    expect(preview.plan.steps.map((step) => step.kind)).toEqual(["deliver"]);
  });

  it("routes evidence-backed project questions to project query", () => {
    const preview = buildMissionPlanPreview({
      message: "Explain how the project handles authentication.",
    });

    expect(preview.admission).toBe("project_query");
    expect(preview.admissionReason).toBe("evidence_or_project_context");
    expect(preview.turnIntent.requiresTools).toBe(true);
  });

  it("routes compound change requests to a Mission without authorizing mutation", () => {
    const preview = buildMissionPlanPreview({
      message: "Inspect the source, then fix the blocking issue.",
    });

    expect(preview.admission).toBe("mission");
    expect(preview.admissionReason).toBe("multi_step_or_mutating_objective");
    expect(preview.plan.steps.some((step) => step.readOnly === false)).toBe(true);
    expect(preview.plan.steps.some((step) => step.approvalRequired)).toBe(true);
  });

  it("carries bounded server-owned recovery context into a replan preview", () => {
    const preview = buildMissionPlanPreview({
      message: "Inspect the source, then fix the blocking issue.",
      objective: "Inspect the source, then fix the blocking issue.",
      replanContext: {
        failedGoalId: "goal-1",
        failureClass: "validation",
        failureCode: "VALIDATION_FAILED",
        affectedPaths: ["src/login.ts"],
        affectedClaims: ["claim:auth-flow"],
        evidenceRefs: ["validation:run-1"],
        hypothesisImpact: "The previous candidate did not satisfy the auth check.",
        nextActions: ["Change the candidate before rerunning validation."],
        priorPlanRevision: "plan-old",
      },
    });

    expect(preview.replanContext).toEqual({
      failedGoalId: "goal-1",
      failureClass: "validation",
      failureCode: "VALIDATION_FAILED",
      affectedPaths: ["src/login.ts"],
      affectedClaims: ["claim:auth-flow"],
      evidenceRefs: ["validation:run-1"],
      hypothesisImpact: "The previous candidate did not satisfy the auth check.",
      nextActions: ["Change the candidate before rerunning validation."],
      priorPlanRevision: "plan-old",
    });
  });
});