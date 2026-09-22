import { describe, expect, it } from "vitest";
import {
  GoalNextActionSchema,
  parseGoalNextAction,
} from "./mission-contract.js";

describe("Mission goal next-action contract", () => {
  it("accepts server-dispatchable task, recipe, wait, and replan intents", () => {
    expect(parseGoalNextAction({
      kind: "task",
      taskId: "task-1",
      purpose: "execution",
    })).toEqual({
      kind: "task",
      taskId: "task-1",
      purpose: "execution",
    });

    expect(parseGoalNextAction({
      kind: "recipe",
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths: ["src/index.ts"],
    })).toEqual({
      kind: "recipe",
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths: ["src/index.ts"],
    });

    expect(parseGoalNextAction({
      kind: "wait",
      reason: "approval",
      wakeAt: null,
    })).toEqual({
      kind: "wait",
      reason: "approval",
      wakeAt: null,
    });

    expect(parseGoalNextAction({
      kind: "replan",
      reason: "validation drift",
    })).toEqual({
      kind: "replan",
      reason: "validation drift",
    });
  });

  it("rejects runtime-owned fields and arbitrary action shapes", () => {
    expect(GoalNextActionSchema.safeParse({
      kind: "recipe",
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths: [],
      sourceRevision: "rev-1",
    }).success).toBe(false);

    expect(GoalNextActionSchema.safeParse({
      owner: "operator",
      action: "approve",
    }).success).toBe(false);
  });
});