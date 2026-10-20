import { describe, expect, it } from "vitest";
import {
  reduceEngineeringAgentProjection,
  type EngineeringAgentGoalFact,
  type EngineeringAgentProjectionContext,
} from "./engineering-agent-projection.js";

const acceptedAttempt: NonNullable<EngineeringAgentGoalFact["currentExecution"]> = {
  id: "execution-1",
  status: "completed",
  acceptance: {
    outcome: "SUCCEEDED",
    terminalStatus: "completed",
    nextActionCode: "NONE",
    evidenceRequired: true,
    evidenceComplete: true,
    resumable: false,
  },
};

const acceptedProof: NonNullable<EngineeringAgentGoalFact["canonicalProof"]> = {
  accepted: true,
  verdict: "PROVEN",
  executionId: "execution-1",
  matchesCurrentAttempt: true,
  failureReasons: [],
};

function goal(overrides: Partial<EngineeringAgentGoalFact> = {}): EngineeringAgentGoalFact {
  return {
    id: "goal-1",
    status: "running",
    currentExecution: {
      id: "execution-1",
      status: "running",
      acceptance: null,
    },
    ...overrides,
  };
}

function context(
  overrides: Partial<EngineeringAgentProjectionContext> = {},
): EngineeringAgentProjectionContext {
  return {
    missionId: "mission-1",
    sessionId: "session-1",
    missionStatus: "active",
    planBinding: "active_revision",
    goals: [goal()],
    missionCompletionAccepted: null,
    autonomyPolicy: {},
    ...overrides,
  };
}

describe("reduceEngineeringAgentProjection", () => {
  it("exposes START for a draft Mission and targets that Mission", () => {
    const projection = reduceEngineeringAgentProjection(context({
      missionStatus: "draft",
      goals: [],
    }));
    expect(projection).toMatchObject({
      schemaVersion: 1,
      state: "PLANNING",
      nextAction: {
        kind: "START",
        target: { kind: "mission", id: "mission-1" },
        reasonCode: "mission_draft",
      },
    });
  });

  it("exposes REPLAN for an eligible current-plan Goal and uses plan order", () => {
    const first = goal({ id: "goal-z", status: "needs_replan" });
    const second = goal({ id: "goal-a", status: "failed" });
    const projection = reduceEngineeringAgentProjection(context({
      goals: [second, first],
      planGoalOrder: ["goal-z", "goal-a"],
    }));
    expect(projection).toMatchObject({
      state: "NEEDS_ATTENTION",
      nextAction: {
        kind: "REPLAN",
        target: { kind: "goal", id: "goal-z" },
        reasonCode: "goal_requires_replan",
      },
    });
  });

  it("does not represent a cancelled Mission as a new STOP operation", () => {
    const projection = reduceEngineeringAgentProjection(context({
      missionStatus: "cancelled",
      goals: [],
    }));
    expect(projection).toMatchObject({
      state: "NEEDS_ATTENTION",
      nextAction: {
        kind: "NONE",
        target: null,
        reasonCode: "mission_cancelled",
      },
      intervention: { required: false, kind: "none", reasonCode: null },
    });
  });

  it("gives an active-plan mismatch precedence over approval and execution state", () => {
    const projection = reduceEngineeringAgentProjection(context({
      planBinding: "revision_mismatch",
      goals: [goal({
        status: "waiting_for_approval",
        nextAction: { kind: "wait", reason: "approval" },
      })],
    }));

    expect(projection).toMatchObject({
      state: "NEEDS_ATTENTION",
      nextAction: {
        kind: "REVIEW",
        target: { kind: "mission", id: "mission-1" },
        reasonCode: "plan_revision_mismatch",
      },
      intervention: { required: true, kind: "scope" },
    });
  });

  it("puts a pending approval ahead of successful-looking execution fields", () => {
    const projection = reduceEngineeringAgentProjection(context({
      goals: [goal({
        status: "waiting_for_approval",
        nextAction: { kind: "wait", reason: "approval" },
        currentExecution: acceptedAttempt,
        canonicalProof: acceptedProof,
      })],
    }));

    expect(projection).toMatchObject({
      state: "AWAITING_APPROVAL",
      nextAction: {
        kind: "APPROVE",
        target: { kind: "goal", id: "goal-1" },
        reasonCode: "approval_pending",
      },
      intervention: { required: true, kind: "approval" },
    });
  });

  it("does not accept a completed attempt while required evidence is incomplete", () => {
    const projection = reduceEngineeringAgentProjection(context({
      goals: [goal({
        status: "completed",
        currentExecution: {
          ...acceptedAttempt,
          acceptance: {
            ...acceptedAttempt.acceptance!,
            evidenceComplete: false,
          },
        },
        canonicalProof: { ...acceptedProof, accepted: false, verdict: "INCOMPLETE" },
      })],
    }));

    expect(projection.state).toBe("NEEDS_ATTENTION");
    expect(projection.nextAction.reasonCode).toBe("required_evidence_incomplete");
    expect(projection.intervention).toMatchObject({ required: true, kind: "review" });
  });

  it("rejects stale proof and does not treat a nonterminal execution as completed", () => {
    const staleProof = reduceEngineeringAgentProjection(context({
      goals: [goal({
        status: "completed",
        currentExecution: acceptedAttempt,
        canonicalProof: {
          ...acceptedProof,
          accepted: false,
          verdict: "UNAVAILABLE",
          failureReasons: ["source_revision_stale"],
        },
      })],
    }));
    expect(staleProof.nextAction.reasonCode).toBe("required_evidence_stale");

    const stillRunning = reduceEngineeringAgentProjection(context({
      goals: [goal({
        status: "running",
        currentExecution: {
          ...acceptedAttempt,
          status: "running",
        },
        canonicalProof: acceptedProof,
      })],
    }));
    expect(stillRunning).toMatchObject({
      state: "WORKING",
      nextAction: { kind: "NONE", reasonCode: "execution_in_progress" },
    });
  });

  it("requires current-attempt proof and the Mission completion gate before COMPLETE", () => {
    const currentGoal = goal({
      status: "completed",
      currentExecution: acceptedAttempt,
      canonicalProof: { ...acceptedProof, executionId: "older-execution", matchesCurrentAttempt: false },
    });
    const stale = reduceEngineeringAgentProjection(context({
      missionStatus: "completed",
      goals: [currentGoal],
      missionCompletionAccepted: true,
    }));
    expect(stale.state).toBe("NEEDS_ATTENTION");
    expect(stale.nextAction.reasonCode).toBe("acceptance_blocked");

    const accepted = reduceEngineeringAgentProjection(context({
      missionStatus: "completed",
      goals: [goal({
        status: "completed",
        currentExecution: acceptedAttempt,
        canonicalProof: acceptedProof,
      })],
      missionCompletionAccepted: true,
    }));
    expect(accepted).toMatchObject({
      state: "COMPLETE",
      nextAction: { kind: "NONE", target: null, reasonCode: "mission_proven_complete" },
      intervention: { required: false, kind: "none", reasonCode: null },
    });
  });

  it("fails closed for a completed Mission with no active Goals", () => {
    const projection = reduceEngineeringAgentProjection(context({
      missionStatus: "completed",
      goals: [],
      missionCompletionAccepted: true,
    }));
    expect(projection.state).toBe("NEEDS_ATTENTION");
    expect(projection.nextAction.reasonCode).toBe("no_active_goal");
  });

  it("reports delivery review rather than auto-pushing an undelivered result", () => {
    const projection = reduceEngineeringAgentProjection(context({
      goals: [goal({
        status: "completed",
        currentExecution: acceptedAttempt,
        canonicalProof: { ...acceptedProof, accepted: false, verdict: "INCOMPLETE" },
        delivery: { required: true, receiptPresent: false },
      })],
      autonomyPolicy: {
        mode: "autonomous",
        allowAutoContinue: true,
        allowAutoPush: true,
        requireHumanForExternalDelivery: false,
      },
    }));

    expect(projection).toMatchObject({
      state: "DELIVERING",
      nextAction: { kind: "REVIEW", reasonCode: "delivery_review_required" },
      intervention: { required: true, kind: "delivery" },
      autonomy: {
        allowAutoPush: false,
        requireHumanForExternalDelivery: true,
      },
    });
  });

  it("emits AUTO_CONTINUE only when policy and Mission Runtime authorization both allow it", () => {
    const queued = goal({
      status: "queued",
      nextAction: { kind: "task" },
      currentExecution: null,
      runtimeContinuationAuthorized: true,
    });
    const policy = {
      mode: "autonomous",
      allowAutoContinue: true,
      maxAutoReplans: 2,
    };
    expect(reduceEngineeringAgentProjection(context({
      goals: [queued],
      autonomyPolicy: policy,
    })).nextAction.kind).toBe("AUTO_CONTINUE");
    expect(reduceEngineeringAgentProjection(context({
      goals: [{ ...queued, runtimeContinuationAuthorized: false }],
      autonomyPolicy: policy,
    })).nextAction.kind).toBe("NONE");
    expect(reduceEngineeringAgentProjection(context({
      goals: [queued],
      autonomyPolicy: { ...policy, mode: "assisted" },
    })).nextAction.kind).toBe("NONE");
  });

  it("keeps running and verifying states separate without inventing actions", () => {
    const running = reduceEngineeringAgentProjection(context({
      goals: [goal()],
    }));
    expect(running).toMatchObject({
      state: "WORKING",
      nextAction: { kind: "NONE", reasonCode: "execution_in_progress" },
    });

    const verifying = reduceEngineeringAgentProjection(context({
      goals: [goal({ status: "verifying" })],
    }));
    expect(verifying).toMatchObject({
      state: "VERIFYING",
      nextAction: { kind: "NONE", reasonCode: "verification_in_progress" },
    });
  });

  it("offers retry or resume only for the current acceptance's explicit disposition", () => {
    const failed = goal({
      status: "failed",
      currentExecution: {
        id: "execution-failed",
        status: "failed",
        acceptance: {
          outcome: "FAILED",
          terminalStatus: "failed",
          nextActionCode: "RETRY_AFTER_TIMEOUT",
          evidenceRequired: false,
          evidenceComplete: false,
          resumable: true,
        },
      },
    });
    expect(reduceEngineeringAgentProjection(context({ goals: [failed] })).nextAction).toMatchObject({
      kind: "RETRY",
      target: { kind: "execution", id: "execution-failed" },
      reasonCode: "execution_retryable",
    });

    const interrupted = goal({
      status: "blocked",
      currentExecution: {
        id: "execution-paused",
        status: "paused",
        acceptance: {
          outcome: "INTERRUPTED",
          terminalStatus: "paused",
          nextActionCode: "RESUME_ALLOWED",
          evidenceRequired: false,
          evidenceComplete: false,
          resumable: true,
        },
      },
    });
    expect(reduceEngineeringAgentProjection(context({ goals: [interrupted] })).nextAction.kind)
      .toBe("RESUME");
    expect(reduceEngineeringAgentProjection(context({
      goals: [{ ...failed, currentExecution: { ...failed.currentExecution!, acceptance: null } }],
    })).nextAction.kind).toBe("REVIEW");
  });

  it("uses deterministic goal identity rather than input order for competing approvals", () => {
    const first = goal({
      id: "goal-a",
      status: "waiting_for_approval",
      nextAction: { kind: "wait", reason: "approval" },
    });
    const second = goal({
      id: "goal-b",
      status: "waiting_for_approval",
      nextAction: { kind: "wait", reason: "approval" },
    });
    const forward = reduceEngineeringAgentProjection(context({ goals: [first, second] }));
    const reversed = reduceEngineeringAgentProjection(context({ goals: [second, first] }));
    expect(forward.goalId).toBe("goal-a");
    expect(reversed.goalId).toBe("goal-a");
  });

  it("normalizes missing or invalid autonomy as assisted with no automatic capability", () => {
    const projection = reduceEngineeringAgentProjection(context({
      goals: [goal({ status: "queued", currentExecution: null, runtimeContinuationAuthorized: true })],
      autonomyPolicy: {
        mode: "unrecognized",
        allowAutoContinue: true,
        allowAutoApply: true,
        allowAutoCommit: true,
        allowAutoPush: true,
        requireHumanForExternalDelivery: false,
        maxAutoReplans: 99,
      },
    }));

    expect(projection.autonomy).toEqual({
      mode: "assisted",
      allowAutoContinue: false,
      allowAutoApply: false,
      allowAutoCommit: false,
      allowAutoPush: false,
      requireHumanForExternalDelivery: true,
      maxAutoReplans: 0,
    });
    expect(projection.nextAction.kind).toBe("NONE");
  });
});
