import { describe, expect, it, vi } from "vitest";
import {
  dispatchEngineeringAgentAction,
  hashEngineeringAgentActionRequest,
  selectEngineeringAgentAction,
  type EngineeringAgentActionHandlers,
} from "./engineering-agent-action.js";
import {
  engineeringAgentActions,
  type EngineeringAgentProjection,
} from "./engineering-agent-projection.js";

const decision: EngineeringAgentProjection["nextAction"] = {
  kind: "NONE",
  target: null,
  reasonCode: "execution_in_progress",
};

function projection(
  overrides: Partial<EngineeringAgentProjection> = {},
): EngineeringAgentProjection {
  return {
    schemaVersion: 2,
    state: "WORKING",
    nextAction: decision,
    availableCommands: [{
      kind: "STOP",
      target: { kind: "execution", id: "execution-1" },
      reasonCode: "execution_in_progress",
    }],
    intervention: { required: false, kind: "none", reasonCode: null },
    autonomy: {
      mode: "assisted",
      allowAutoContinue: false,
      allowAutoApply: false,
      allowAutoCommit: false,
      allowAutoPush: false,
      requireHumanForExternalDelivery: true,
      maxAutoReplans: 0,
    },
    missionId: "mission-1",
    sessionId: null,
    goalId: "goal-1",
    executionId: "execution-1",
    ...overrides,
  };
}

describe("Engineering Agent action selection", () => {
  it("requires the exact current decision identity", () => {
    expect(selectEngineeringAgentAction(projection(), decision)).toEqual({
      ok: true,
      action: "NONE",
      decision,
    });
    expect(selectEngineeringAgentAction(projection(), {
      ...decision,
      reasonCode: "state_unresolved",
    })).toEqual({ ok: false, reason: "stale_decision" });
    expect(selectEngineeringAgentAction(projection(), {
      ...decision,
      target: { kind: "execution", id: "other-execution" },
    })).toEqual({ ok: false, reason: "stale_decision" });
  });

  it("selects an optional STOP only from the current server projection", () => {
    expect(selectEngineeringAgentAction(projection(), decision, "STOP")).toEqual({
      ok: true,
      action: "STOP",
      decision: {
        kind: "STOP",
        target: { kind: "execution", id: "execution-1" },
        reasonCode: "execution_in_progress",
      },
    });
    expect(selectEngineeringAgentAction(projection({
      availableCommands: [],
    }), decision, "STOP")).toEqual({
      ok: false,
      reason: "command_unavailable",
    });
  });

  it("binds idempotency to the decision, optional command, and action inputs", () => {
    const base = {
      missionId: "mission-1",
      expectedDecision: decision,
    };
    const requestHash = hashEngineeringAgentActionRequest(base);
    expect(hashEngineeringAgentActionRequest(base)).toBe(requestHash);
    expect(hashEngineeringAgentActionRequest({
      ...base,
      command: "STOP",
    })).not.toBe(requestHash);
    expect(hashEngineeringAgentActionRequest({
      ...base,
      input: { replan: { objective: "A different objective" } },
    })).not.toBe(requestHash);
  });

  it("dispatches every declared action through an explicit handler", async () => {
    const handler = vi.fn(() => ({ outcome: "accepted" as const }));
    const handlers = {
      START: handler,
      AUTO_CONTINUE: handler,
      RESUME: handler,
      RETRY: handler,
      APPROVE: handler,
      REPLAN: handler,
      REVIEW: handler,
      STOP: handler,
      NONE: handler,
    } satisfies EngineeringAgentActionHandlers;

    for (const action of engineeringAgentActions) {
      await expect(dispatchEngineeringAgentAction(action, {
        missionId: "mission-1",
        userId: "user-1",
        decision: { ...decision, kind: action },
      }, handlers)).resolves.toEqual({ outcome: "accepted" });
    }
    expect(handler).toHaveBeenCalledTimes(engineeringAgentActions.length);
  });
});
