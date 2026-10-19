import { describe, expect, it } from "vitest";
import { aiGoalsTable, aiMissionsTable } from "@workspace/db";
import { applyChangesMissionRequirement } from "./apply-changes-mission-gate.js";

const proposalId = "proposal-apply-mission";
const baseRevision = "a".repeat(40);
const candidateTreeHash = "b".repeat(64);
const changeSetHash = "c".repeat(64);
const baseTreeHash = "e".repeat(64);
const operationId = "operation-apply-mission";
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
const applyMissionBinding = {
  proposalId,
  proposalRevision: 3,
  baseTreeHash,
  operationId,
  candidateIdentity: `${proposalId}:${candidateTreeHash}`,
  baseRevision,
  candidateTreeHash,
  changeSetHash,
  requirement,
};

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
      applyMission: applyMissionBinding,
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
      proposalRevision: 3,
      baseTreeHash,
      operationId,
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

  it.each([
    "proposalRevision",
    "baseTreeHash",
    "operationId",
    "candidateIdentity",
  ] as const)("requires the bound Proposal %s on a linked Mission", (field) => {
    const incompleteBinding = { ...applyMissionBinding } as Record<string, unknown>;
    delete incompleteBinding[field];
    const { goal, mission } = fixtures({
      missionPolicy: {
        activePlanRevision: planRevision,
        applyMission: incompleteBinding,
      },
    });

    expect(applyChangesMissionRequirement(goal, mission, planRevision)).toMatchObject({
      kind: "invalid",
      reason: "apply_plan_binding_invalid",
    });
  });

  it.each([
    ["proposalId", "other-proposal"],
    ["baseRevision", "other-revision"],
    ["candidateTreeHash", "f".repeat(64)],
    ["changeSetHash", "f".repeat(64)],
  ] as const)("rejects a Mission binding whose %s differs from its requirement", (field, value) => {
    const changedBinding = {
      ...applyMissionBinding,
      [field]: value,
    };
    const { goal, mission } = fixtures({
      missionPolicy: {
        activePlanRevision: planRevision,
        applyMission: changedBinding,
      },
    });

    expect(applyChangesMissionRequirement(goal, mission, planRevision)).toMatchObject({
      kind: "invalid",
      reason: "apply_plan_binding_invalid",
    });
  });

  it("does not classify a Proposal-linked Mission as legacy when its Goal is relabeled", () => {
    const { goal, mission } = fixtures({
      criteria: { stepId: "report-applied" },
      outcome: { stepId: "report-applied" },
    });

    expect(applyChangesMissionRequirement(goal, mission, planRevision)).toMatchObject({
      kind: "invalid",
      reason: "apply_requirement_invalid",
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