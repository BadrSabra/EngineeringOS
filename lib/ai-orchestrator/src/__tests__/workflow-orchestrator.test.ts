import { describe, it, expect } from "vitest";
import { validateDecision, executeDecision, type WorkflowState } from "../agents/workflow-orchestrator.js";
import type { WorkflowDecision } from "../schemas/workflow.schema.js";

const phases = [
  { name: "plan", steps: ["write spec"] },
  { name: "build", steps: ["implement"] },
  { name: "verify", steps: ["test"] },
];

describe("validateDecision", () => {
  it("passes through a valid advance to a known next phase", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "plan is done", nextPhase: "build" };
    const result = validateDecision(decision, { phases, currentPhase: "plan" });
    expect(result).toEqual(decision);
  });

  it("passes through wait/fail decisions unchanged", () => {
    const decision: WorkflowDecision = { action: "wait", reasoning: "blocked on review" };
    expect(validateDecision(decision, { phases, currentPhase: "plan" })).toEqual(decision);
  });

  it("rejects advance with no nextPhase", () => {
    // Cast required: the schema now rejects this shape at parse time, but
    // validateDecision() still defends against it as a belt-and-suspenders guard.
    const decision = { action: "advance", reasoning: "go" } as unknown as WorkflowDecision;
    const result = validateDecision(decision, { phases, currentPhase: "plan" });
    expect(result.action).toBe("wait");
  });

  it("rejects advance to an unknown phase name", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "deploy-to-mars" };
    const result = validateDecision(decision, { phases, currentPhase: "plan" });
    expect(result.action).toBe("wait");
    // Narrow to the wait variant before accessing blockers.
    expect(result.action === "wait" ? result.blockers?.[0] : undefined).toMatch(/not a defined phase/);
  });

  it("rejects advance to the already-current phase (no-op transition)", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "plan" };
    const result = validateDecision(decision, { phases, currentPhase: "plan" });
    expect(result.action).toBe("wait");
  });

  it("rejects complete when not at the final phase", () => {
    const decision: WorkflowDecision = { action: "complete", reasoning: "done" };
    const result = validateDecision(decision, { phases, currentPhase: "plan" });
    expect(result.action).toBe("wait");
  });

  it("allows complete at the final phase", () => {
    const decision: WorkflowDecision = { action: "complete", reasoning: "done" };
    const result = validateDecision(decision, { phases, currentPhase: "verify" });
    expect(result).toEqual(decision);
  });
});

describe("executeDecision", () => {
  const baseState: WorkflowState = { phases, currentPhase: "plan", completedPhases: [] };

  it("advances currentPhase and records the old phase as completed", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "build" };
    const next = executeDecision(decision, baseState);
    expect(next.currentPhase).toBe("build");
    expect(next.completedPhases).toEqual(["plan"]);
  });

  it("does not duplicate an already-completed phase", () => {
    const state: WorkflowState = { phases, currentPhase: "plan", completedPhases: ["plan"] };
    const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "build" };
    const next = executeDecision(decision, state);
    expect(next.completedPhases).toEqual(["plan"]);
  });

  it("completing clears currentPhase and marks it completed", () => {
    const state: WorkflowState = { phases, currentPhase: "verify", completedPhases: ["plan", "build"] };
    const decision: WorkflowDecision = { action: "complete", reasoning: "done" };
    const next = executeDecision(decision, state);
    expect(next.currentPhase).toBeNull();
    expect(next.completedPhases).toEqual(["plan", "build", "verify"]);
  });

  it("wait/fail leave state untouched", () => {
    const decision: WorkflowDecision = { action: "wait", reasoning: "blocked" };
    expect(executeDecision(decision, baseState)).toEqual(baseState);
  });

  // ── Internal validation guard ─────────────────────────────────────────────
  // These cases prove that executeDecision rejects illegal transitions even
  // when the caller has not gone through validateDecision() first.

  it("rejects advance to an unknown phase without mutating state", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "deploy-to-mars" };
    const next = executeDecision(decision, baseState);
    expect(next).toEqual(baseState);
  });

  it("rejects advance to the already-current phase without mutating state", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "plan" };
    const next = executeDecision(decision, baseState);
    expect(next).toEqual(baseState);
  });

  it("rejects premature complete (not at final phase) without mutating state", () => {
    // currentPhase is "plan", final phase is "verify" — complete is premature.
    const decision: WorkflowDecision = { action: "complete", reasoning: "done" };
    const next = executeDecision(decision, baseState);
    expect(next).toEqual(baseState);
  });

  it("allows complete only when at the final phase", () => {
    const state: WorkflowState = { phases, currentPhase: "verify", completedPhases: ["plan", "build"] };
    const decision: WorkflowDecision = { action: "complete", reasoning: "done" };
    const next = executeDecision(decision, state);
    expect(next.currentPhase).toBeNull();
    expect(next.completedPhases).toContain("verify");
  });
});
