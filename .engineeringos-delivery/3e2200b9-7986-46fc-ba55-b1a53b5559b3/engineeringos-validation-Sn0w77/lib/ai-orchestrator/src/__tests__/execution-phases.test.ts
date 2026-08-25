import { describe, expect, it } from "vitest";
import {
  createExecutionPhaseState,
  EXECUTION_PHASES,
  getPhaseBudget,
  isToolAllowedInPhase,
  transitionExecutionPhase,
} from "../quality/execution-phases.js";
import { buildExecutionPlan } from "../model-selection/execution-plan.js";

describe("server-owned execution phases", () => {
  it("defines independent bounded budgets for every repair phase", () => {
    const plan = buildExecutionPlan("task-runner");
    expect(EXECUTION_PHASES).toEqual([
      "localization", "evidence", "patch_proposal",
      "validation", "repair_recovery", "report",
    ]);
    expect(plan.phases.validation.maxToolCalls).toBeLessThan(plan.phases.evidence.maxToolCalls);
    expect(plan.phases.report.maxToolCalls).toBe(0);
    expect(getPhaseBudget("patch_proposal").maxOutputTokens).toBeGreaterThan(0);
  });

  it("allows only phase-relevant tools", () => {
    expect(isToolAllowedInPhase("evidence", "read_file")).toBe(true);
    expect(isToolAllowedInPhase("evidence", "write_file")).toBe(false);
    expect(isToolAllowedInPhase("validation", "run_validation")).toBe(true);
    expect(isToolAllowedInPhase("report", "read_file")).toBe(false);
  });

  it("walks the complete journey and requires validation before reporting", () => {
    let state = createExecutionPhaseState();
    const advance = (
      next: Parameters<typeof transitionExecutionPhase>[1],
      evidence?: Parameters<typeof transitionExecutionPhase>[2],
    ) => {
      const result = transitionExecutionPhase(state, next, evidence);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    };

    advance("evidence");
    advance("patch_proposal");
    advance("validation");
    expect(transitionExecutionPhase(state, "report", "failed").ok).toBe(false);
    advance("repair_recovery", "failed");
    advance("validation");
    advance("report", "passed");

    expect(state.completed).toEqual([
      "localization",
      "evidence",
      "patch_proposal",
      "validation",
      "repair_recovery",
      "validation",
    ]);
    expect(state.validationEvidence).toBe("passed");
    expect(state.repairAttempts).toBe(1);
  });

  it("rejects skipped, backward, and evidence-free transitions", () => {
    const initial = createExecutionPhaseState();
    expect(transitionExecutionPhase(initial, "patch_proposal").ok).toBe(false);
    const evidence = transitionExecutionPhase(initial, "evidence");
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    expect(transitionExecutionPhase(evidence.state, "localization").ok).toBe(false);
    const validation = transitionExecutionPhase(
      transitionExecutionPhase(evidence.state, "patch_proposal").ok
        ? transitionExecutionPhase(evidence.state, "patch_proposal").state
        : evidence.state,
      "validation",
    );
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(transitionExecutionPhase(validation.state, "report").ok).toBe(false);
    }
  });

  it("requires a failed validation result to enter recovery", () => {
    let state = createExecutionPhaseState();
    for (const phase of ["evidence", "patch_proposal", "validation"] as const) {
      const result = transitionExecutionPhase(state, phase);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }

    expect(transitionExecutionPhase(state, "repair_recovery", "passed").ok).toBe(false);
    const recovery = transitionExecutionPhase(state, "repair_recovery", "failed");
    expect(recovery.ok).toBe(true);
    if (!recovery.ok) return;
    expect(transitionExecutionPhase(recovery.state, "report", "passed").ok).toBe(false);
    expect(transitionExecutionPhase(recovery.state, "validation").ok).toBe(true);
  });
});