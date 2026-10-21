import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  engineeringAgentActions,
  type EngineeringAgentAction,
  type EngineeringAgentProjection,
} from "./engineering-agent-projection.js";

export type EngineeringAgentDecisionIdentity = {
  kind: EngineeringAgentAction;
  target: EngineeringAgentProjection["nextAction"]["target"];
  reasonCode: string;
};
export type EngineeringAgentOptionalCommand = "STOP";

export interface EngineeringAgentActionInput {
  replan?: {
    objective?: string;
    reason?: string;
    expectedPlanHash?: string;
  };
}

export interface EngineeringAgentActionContext {
  missionId: string;
  userId: string;
  decision: EngineeringAgentProjection["nextAction"];
  input?: EngineeringAgentActionInput;
}

export interface EngineeringAgentActionOperation {
  goalId?: string;
  executionId?: string;
  planRevision?: string;
  status?: string;
  attempt?: number;
}

export interface EngineeringAgentActionResult {
  outcome:
    | "accepted"
    | "in_progress"
    | "completed"
    | "review_required"
    | "no_action"
    | "rejected";
  operation?: EngineeringAgentActionOperation;
  run?: {
    status: string;
    goalId: string;
    taskId: string | null;
    executionId: string | null;
    reason: string | null;
  };
  recovery?: {
    executionId: string;
    resumeToken: string;
    attempt: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export type EngineeringAgentActionHandler = (
  context: EngineeringAgentActionContext,
) => Promise<EngineeringAgentActionResult> | EngineeringAgentActionResult;

/**
 * The complete action map is intentionally required at call sites. Adding an
 * action to the projection enum without adding a server-owned handler is a
 * compile-time error.
 */
export type EngineeringAgentActionHandlers =
  Record<EngineeringAgentAction, EngineeringAgentActionHandler>;

export type EngineeringAgentActionSelection =
  | {
      ok: true;
      action: EngineeringAgentAction;
      decision: EngineeringAgentProjection["nextAction"];
    }
  | {
      ok: false;
      reason: "stale_decision" | "command_unavailable";
    };

export function selectEngineeringAgentAction(
  projection: EngineeringAgentProjection,
  expectedDecision: EngineeringAgentDecisionIdentity,
  command?: EngineeringAgentOptionalCommand,
): EngineeringAgentActionSelection {
  if (!isDeepStrictEqual(expectedDecision, projection.nextAction)) {
    return { ok: false, reason: "stale_decision" };
  }

  if (command) {
    const available = projection.availableCommands.find((candidate) =>
      candidate.kind === command,
    );
    if (!available) return { ok: false, reason: "command_unavailable" };
    return { ok: true, action: available.kind, decision: available };
  }

  return {
    ok: true,
    action: projection.nextAction.kind,
    decision: projection.nextAction,
  };
}

export function hashEngineeringAgentActionRequest(params: {
  missionId: string;
  expectedDecision: EngineeringAgentDecisionIdentity;
  command?: EngineeringAgentOptionalCommand;
  input?: EngineeringAgentActionInput;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      missionId: params.missionId,
      expectedDecision: params.expectedDecision,
      command: params.command ?? null,
      input: params.input ?? null,
    }))
    .digest("hex");
}

export async function dispatchEngineeringAgentAction(
  action: EngineeringAgentAction,
  context: EngineeringAgentActionContext,
  handlers: EngineeringAgentActionHandlers,
): Promise<EngineeringAgentActionResult> {
  // Keep the runtime check alongside the exhaustive TypeScript map so malformed
  // JavaScript callers also fail closed rather than invoking an arbitrary name.
  if (!(engineeringAgentActions as readonly string[]).includes(action)) {
    return {
      outcome: "rejected",
      error: {
        code: "AGENT_ACTION_UNSUPPORTED",
        message: "This Engineering Agent action is not supported.",
      },
    };
  }
  return handlers[action](context);
}
