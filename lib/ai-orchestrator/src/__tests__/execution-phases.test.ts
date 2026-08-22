import { describe, expect, it } from "vitest";
import {
  EXECUTION_PHASES,
  getPhaseBudget,
  isToolAllowedInPhase,
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
});