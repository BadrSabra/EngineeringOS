import { describe, expect, it } from "vitest";
import { aiGoalsTable, aiMissionsTable } from "@workspace/db";
import { applyChangesMissionRequirement } from "./apply-changes-mission-gate.js";

const proposalId = "proposal-apply-mission";
const baseRevision = "a".repeat(40);
const candidateTreeHash = "b".repeat(64);
const changeSetHash = "c".repeat(64);
const planRevision = "d".repeat(64);

const requirement = {
  kind: "apply.changes",
  version: 1,
  sourceStepId: "apply-changes",
  proposalId,
  baseRevision,
  candidateTreeHash,
  changeSetHash,
  from: "candidate",
  to: "applied",
} as const;

function fixtures(overrides: {
  criteria?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  missionPolicy?: Record<string, unknown>;
} = {}) {
  const plan = {
    hash: planRevision,
    applyRequirement: requirement,
    steps: [
      { id: "apply-changes", dependencies: [] },
      { id: "report-applied", dependencies: ["apply-changes"] },
    ],
  };
  const goal = {
    successCriteria: overrides.criteria ?? {
      stepId: "apply-changes",
      applyRequirement: requirement,
      planRevision: plan,
    },
    outcomeContract: overrides.outcome ?? {
      stepId: "apply-changes",
      applyRequirement: requirement,
      candidateIdentity: `${proposalId}:${candidateTreeHash}`,
      planRevision: plan,
    },
    nextAction: { kind: "wait", reason: "event", wakeAt: null },
  } as unknown as typeof aiGoalsTable.$inferSelect;
  const mission = {
    autonomyPolicy: overrides.missionPolicy ?? {
      activePlanRevision: planRevision,
      applyMission: { proposalId, requirement },
    },
  } as unknown as typeof aiMissionsTable.$inferSelect;
  return { goal, mission };
}

describe("applyChangesMissionRequirement", () => {
  it("accepts only the immutable two-step apply/report plan and active Mission binding", () => {
    const { goal, mission } = fixtures();

    expect(applyChangesMissionRequirement(goal, mission, planRevision)).toEqual({
      kind: "valid",
      requirement,
      planRevision,
      candidateIdentity: `${proposalId}:${candidateTreeHash}`,
    });
  });

  it("treats Mission-level apply linkage as proof-required even if the Goal contract is missing", () => {
    const { goal, mission } = fixtures({
      criteria: { stepId: "apply-changes", planRevision: { hash: planRevision } },
      outcome: { stepId: "apply-changes", planRevision: { hash: planRevision } },
    });

    expect(applyChangesMissionRequirement(goal, mission, planRevision)).toMatchObject({
      kind: "invalid",
    });
  });

  it("rejects a candidate identity or successor dependency that differs from the plan", () => {
    const wrongOutcome = {
      stepId: "apply-changes",
      applyRequirement: requirement,
      candidateIdentity: candidateTreeHash,
      planRevision: {
        hash: planRevision,
        applyRequirement: requirement,
        steps: [
          { id: "apply-changes", dependencies: [] },
          { id: "report-applied", dependencies: [] },
        ],
      },
    };
    const { goal, mission } = fixtures({ outcome: wrongOutcome });

    expect(applyChangesMissionRequirement(goal, mission, planRevision)).toMatchObject({
      kind: "invalid",
      reason: "apply_plan_shape_invalid",
    });
  });

  it("rejects missing or stale active plan linkage", () => {
    const { goal, mission } = fixtures();

    expect(applyChangesMissionRequirement(goal, mission, "e".repeat(64))).toMatchObject({
      kind: "invalid",
      reason: "apply_plan_binding_invalid",
    });
  });

  it("leaves unlinked legacy Goals on the route-only path", () => {
    const { goal, mission } = fixtures({
      criteria: { stepId: "legacy-step" },
      outcome: { stepId: "legacy-step" },
      missionPolicy: { activePlanRevision: planRevision },
    });

    expect(applyChangesMissionRequirement(goal, mission, planRevision)).toEqual({ kind: "none" });
  });
});