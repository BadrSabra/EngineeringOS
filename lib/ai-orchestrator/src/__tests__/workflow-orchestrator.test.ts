import { describe, it, expect } from "vitest";
import { validateDecision, executeDecision, type WorkflowState } from "../agents/workflow-orchestrator.js";
import type { WorkflowDecision } from "../schemas/workflow.schema.js";

const phases = [
  { name: "plan", steps: ["write spec"] },
  { name: "build", steps: ["implement"] },
  { name: "verify", steps: ["test"] },
];

// ── validateDecision ──────────────────────────────────────────────────────────

describe("validateDecision", () => {
  // ── baseline ────────────────────────────────────────────────────────────────

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

  // ── linear phase ordering (PR-01) ─────────────────────────────────────────

  it("rejects phase skip (plan → verify)", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "skip build", nextPhase: "verify" };
    const result = validateDecision(decision, { phases, currentPhase: "plan" });
    expect(result.action).toBe("wait");
    expect(result.action === "wait" ? result.blockers?.[0] : undefined).toMatch(/immediate successor/);
  });

  it("accepts sequential advance (plan → build)", () => {
    const decision: WorkflowDecision = { action: "advance", reasoning: "plan complete", nextPhase: "build" };
    const result = validateDecision(decision, { phases, currentPhase: "plan" });
    expect(result).toEqual(decision);
  });

  it("skips the linear guard when currentPhase is null (unstarted workflow)", () => {
    // Any known phase is allowed as the first phase when the workflow hasn't started.
    const decision: WorkflowDecision = { action: "advance", reasoning: "start", nextPhase: "build" };
    const result = validateDecision(decision, { phases, currentPhase: null });
    expect(result).toEqual(decision);
  });

  // ── invalid nextPhase ────────────────────────────────────────────────────────

  describe("invalid nextPhase", () => {
    it("rejects a phase name that differs only by case", () => {
      // Phase matching is exact-string: "Build" is not "build".
      const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "Build" };
      const result = validateDecision(decision, { phases, currentPhase: "plan" });
      expect(result.action).toBe("wait");
      expect(result.action === "wait" ? result.blockers?.[0] : undefined).toMatch(/not a defined phase/);
    });

    it("blocker message quotes the attempted phase name verbatim", () => {
      const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "deploy-to-mars" };
      const result = validateDecision(decision, { phases, currentPhase: "plan" });
      const blocker = result.action === "wait" ? result.blockers?.[0] : undefined;
      expect(blocker).toContain("deploy-to-mars");
    });

    it("passes advance when currentPhase is null — null is not equal to any phase name", () => {
      // A workflow that has not yet started (currentPhase = null) can advance
      // to the first phase; this is not a self-reference.
      const decision: WorkflowDecision = { action: "advance", reasoning: "starting", nextPhase: "plan" };
      const result = validateDecision(decision, { phases, currentPhase: null });
      expect(result.action).toBe("advance");
    });

    it("rejects a backward advance (build → plan) — linear ordering blocks non-successive transitions", () => {
      // The linear ordering guard rejects any nextPhase that is not the
      // immediate successor of the current phase. Backward moves (re-running a
      // completed phase) are caller-level concerns and are not allowed through
      // validateDecision now that PR-01 enforces sequential ordering.
      const decision: WorkflowDecision = { action: "advance", reasoning: "re-running plan", nextPhase: "plan" };
      const result = validateDecision(decision, { phases, currentPhase: "build" });
      expect(result.action).toBe("wait");
      expect(result.action === "wait" ? result.blockers?.[0] : undefined).toMatch(/immediate successor/);
    });

    it("rejects advance to the last phase when already at the last phase", () => {
      const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "verify" };
      const result = validateDecision(decision, { phases, currentPhase: "verify" });
      expect(result.action).toBe("wait");
    });
  });

  // ── premature complete ───────────────────────────────────────────────────────

  describe("premature complete", () => {
    it("rejects complete when currentPhase is null and phases are defined", () => {
      // null !== lastPhase.name → rejected.
      const result = validateDecision(
        { action: "complete", reasoning: "done" },
        { phases, currentPhase: null },
      );
      expect(result.action).toBe("wait");
    });

    it("rejects complete from the second-to-last phase", () => {
      const result = validateDecision(
        { action: "complete", reasoning: "done" },
        { phases, currentPhase: "build" },
      );
      expect(result.action).toBe("wait");
    });

    it("blocker message for premature complete names the required final phase", () => {
      const result = validateDecision(
        { action: "complete", reasoning: "done" },
        { phases, currentPhase: "plan" },
      );
      const blocker = result.action === "wait" ? result.blockers?.[0] : undefined;
      expect(blocker).toContain("verify");
    });

    it("blocker message for premature complete names the current phase", () => {
      const result = validateDecision(
        { action: "complete", reasoning: "done" },
        { phases, currentPhase: "build" },
      );
      const blocker = result.action === "wait" ? result.blockers?.[0] : undefined;
      expect(blocker).toContain("build");
      expect(blocker).toContain("verify");
    });

    it("passes complete when the phases list is empty — guard requires phases.length > 0", () => {
      // With no phases defined, complete is always structurally valid.
      const result = validateDecision(
        { action: "complete", reasoning: "nothing to run" },
        { phases: [], currentPhase: null },
      );
      expect(result.action).toBe("complete");
    });
  });

  // ── no-op decisions ──────────────────────────────────────────────────────────

  describe("no-op decisions", () => {
    it("passes fail through unchanged", () => {
      const decision: WorkflowDecision = { action: "fail", reasoning: "build exploded" };
      const result = validateDecision(decision, { phases, currentPhase: "build" });
      expect(result).toEqual(decision);
    });

    it("passes wait with blockers through unchanged", () => {
      const decision: WorkflowDecision = {
        action: "wait",
        reasoning: "CI is red",
        blockers: ["tests failing in build phase"],
      };
      const result = validateDecision(decision, { phases, currentPhase: "build" });
      expect(result).toEqual(decision);
    });

    it("passes wait with suggestions through unchanged", () => {
      const decision: WorkflowDecision = {
        action: "wait",
        reasoning: "hold for review",
        suggestions: ["unblock by adding smoke test to verify phase"],
      };
      const result = validateDecision(decision, { phases, currentPhase: "plan" });
      expect(result).toEqual(decision);
    });

    it("passes fail with suggestions through unchanged", () => {
      const decision: WorkflowDecision = {
        action: "fail",
        reasoning: "dependency unavailable",
        suggestions: ["retry after upgrading the dependency"],
      };
      const result = validateDecision(decision, { phases, currentPhase: "build" });
      expect(result).toEqual(decision);
    });
  });
});

// ── executeDecision ───────────────────────────────────────────────────────────

describe("executeDecision", () => {
  const baseState: WorkflowState = { phases, currentPhase: "plan", completedPhases: [] };

  // ── baseline ────────────────────────────────────────────────────────────────

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

  // ── internal validation guard ────────────────────────────────────────────────

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

  // ── retry ────────────────────────────────────────────────────────────────────

  describe("retry", () => {
    it("fail leaves state unchanged so a subsequent advance succeeds from the same position", () => {
      const failDecision: WorkflowDecision = { action: "fail", reasoning: "build broke" };
      const afterFail = executeDecision(failDecision, baseState);
      expect(afterFail).toEqual(baseState); // no mutation

      const retryDecision: WorkflowDecision = { action: "advance", reasoning: "fixed", nextPhase: "build" };
      const afterRetry = executeDecision(retryDecision, afterFail);
      expect(afterRetry.currentPhase).toBe("build");
      expect(afterRetry.completedPhases).toContain("plan");
    });

    it("wait preserves state so the same advance can be attempted again", () => {
      const waitDecision: WorkflowDecision = {
        action: "wait",
        reasoning: "CI pending",
        blockers: ["tests still running"],
      };
      const afterWait = executeDecision(waitDecision, baseState);
      expect(afterWait).toEqual(baseState);

      const advance: WorkflowDecision = { action: "advance", reasoning: "CI passed", nextPhase: "build" };
      const afterAdvance = executeDecision(advance, afterWait);
      expect(afterAdvance.currentPhase).toBe("build");
    });

    it("multiple consecutive fail decisions do not accumulate state changes", () => {
      const fail: WorkflowDecision = { action: "fail", reasoning: "still broken" };
      const s1 = executeDecision(fail, baseState);
      const s2 = executeDecision(fail, s1);
      const s3 = executeDecision(fail, s2);
      expect(s3).toEqual(baseState);
    });

    it("fail after a valid advance leaves the post-advance state intact", () => {
      const advance: WorkflowDecision = { action: "advance", reasoning: "plan done", nextPhase: "build" };
      const afterAdvance = executeDecision(advance, baseState);
      expect(afterAdvance.currentPhase).toBe("build");

      const fail: WorkflowDecision = { action: "fail", reasoning: "build failed" };
      const afterFail = executeDecision(fail, afterAdvance);
      // State is frozen at the post-advance position, not rolled back.
      expect(afterFail).toEqual(afterAdvance);
    });
  });

  // ── state ordering ───────────────────────────────────────────────────────────

  describe("state ordering", () => {
    it("completedPhases accumulates in advance order across a full three-phase walk", () => {
      const s0: WorkflowState = { phases, currentPhase: "plan", completedPhases: [] };

      const s1 = executeDecision({ action: "advance", reasoning: "ok", nextPhase: "build" }, s0);
      expect(s1.currentPhase).toBe("build");
      expect(s1.completedPhases).toEqual(["plan"]);

      const s2 = executeDecision({ action: "advance", reasoning: "ok", nextPhase: "verify" }, s1);
      expect(s2.currentPhase).toBe("verify");
      expect(s2.completedPhases).toEqual(["plan", "build"]);

      const s3 = executeDecision({ action: "complete", reasoning: "done" }, s2);
      expect(s3.currentPhase).toBeNull();
      expect(s3.completedPhases).toEqual(["plan", "build", "verify"]);
    });

    it("phases not yet reached are absent from completedPhases after each step", () => {
      const s0: WorkflowState = { phases, currentPhase: "plan", completedPhases: [] };
      const s1 = executeDecision({ action: "advance", reasoning: "ok", nextPhase: "build" }, s0);
      // "build" is now current, not yet completed; "verify" has never been touched.
      expect(s1.completedPhases).not.toContain("build");
      expect(s1.completedPhases).not.toContain("verify");
    });

    it("the phases array on the state object is not mutated by executeDecision", () => {
      const phasesCopy = phases.map((p) => ({ ...p }));
      const state: WorkflowState = { phases: phasesCopy, currentPhase: "plan", completedPhases: [] };
      const phasesRef = state.phases;
      executeDecision({ action: "advance", reasoning: "ok", nextPhase: "build" }, state);
      expect(state.phases).toBe(phasesRef); // same reference — not replaced
      expect(state.phases).toEqual(phasesCopy); // same content — not mutated
    });

    it("the completedPhases array from the input state is not mutated", () => {
      const original = ["plan"];
      const state: WorkflowState = { phases, currentPhase: "build", completedPhases: original };
      executeDecision({ action: "advance", reasoning: "ok", nextPhase: "verify" }, state);
      // advanceCompletedPhases() spreads into a new array — the original must be untouched.
      expect(original).toEqual(["plan"]);
    });

    it("executeDecision is pure: two calls with the same inputs produce the same output", () => {
      const decision: WorkflowDecision = { action: "advance", reasoning: "ok", nextPhase: "build" };
      const r1 = executeDecision(decision, baseState);
      const r2 = executeDecision(decision, baseState);
      expect(r1).toEqual(r2);
    });
  });

  // ── advance from null currentPhase ───────────────────────────────────────────

  describe("advance from null currentPhase (workflow not yet started)", () => {
    const unstarted: WorkflowState = { phases, currentPhase: null, completedPhases: [] };

    it("sets currentPhase correctly", () => {
      const next = executeDecision({ action: "advance", reasoning: "starting", nextPhase: "plan" }, unstarted);
      expect(next.currentPhase).toBe("plan");
    });

    it("does not add null to completedPhases — null currentPhase is skipped by advanceCompletedPhases", () => {
      const next = executeDecision({ action: "advance", reasoning: "starting", nextPhase: "plan" }, unstarted);
      expect(next.completedPhases).toEqual([]);
      expect(next.completedPhases).not.toContain(null);
    });

    it("advancing to any known phase from null is valid", () => {
      // validateDecision: null !== "verify", "verify" is a known phase → passes.
      const next = executeDecision({ action: "advance", reasoning: "jump to verify", nextPhase: "verify" }, unstarted);
      expect(next.currentPhase).toBe("verify");
    });
  });

  // ── invalid advance ───────────────────────────────────────────────────────────

  describe("invalid advance", () => {
    it("rejects a case-mismatched phase name without mutating state", () => {
      const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "Build" };
      expect(executeDecision(decision, baseState)).toEqual(baseState);
    });

    it("rejects advance to the penultimate phase when already there", () => {
      const state: WorkflowState = { phases, currentPhase: "build", completedPhases: ["plan"] };
      const decision: WorkflowDecision = { action: "advance", reasoning: "go", nextPhase: "build" };
      expect(executeDecision(decision, state)).toEqual(state);
    });
  });

  // ── premature complete ────────────────────────────────────────────────────────

  describe("premature complete", () => {
    it("rejects complete from the first phase without mutating state", () => {
      expect(executeDecision({ action: "complete", reasoning: "done" }, baseState)).toEqual(baseState);
    });

    it("rejects complete from the second-to-last phase without mutating state", () => {
      const state: WorkflowState = { phases, currentPhase: "build", completedPhases: ["plan"] };
      expect(executeDecision({ action: "complete", reasoning: "done" }, state)).toEqual(state);
    });

    it("rejects complete when currentPhase is null and phases are defined", () => {
      const state: WorkflowState = { phases, currentPhase: null, completedPhases: [] };
      expect(executeDecision({ action: "complete", reasoning: "done" }, state)).toEqual(state);
    });

    it("accepts complete on a zero-phase workflow — no final-phase guard applies", () => {
      const state: WorkflowState = { phases: [], currentPhase: null, completedPhases: [] };
      const next = executeDecision({ action: "complete", reasoning: "nothing to run" }, state);
      expect(next.currentPhase).toBeNull();
    });
  });
});
