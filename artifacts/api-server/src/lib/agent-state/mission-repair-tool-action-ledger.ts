import { and, eq } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  db,
} from "@workspace/db";
import {
  canonicalJsonHash,
  parseAgentActionRequestedPayload,
  type AgentAction,
} from "@workspace/ai-orchestrator";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export async function assertMissionRepairToolActionRequested(input: {
  projectId: string;
  episodeId: string;
  executionId: string;
  attempt: number;
  expectedAction: AgentAction;
}): Promise<void> {
  const events = await db.select({
    actorType: aiAgentEpisodeEventsTable.actorType,
    payload: aiAgentEpisodeEventsTable.payload,
  }).from(aiAgentEpisodeEventsTable).where(and(
    eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
    eq(aiAgentEpisodeEventsTable.episodeId, input.episodeId),
    eq(aiAgentEpisodeEventsTable.executionId, input.executionId),
    eq(aiAgentEpisodeEventsTable.attempt, input.attempt),
    eq(aiAgentEpisodeEventsTable.eventType, "ACTION_REQUESTED"),
  ));

  const matchingEvents = events.filter(({ payload }) => {
    const record = asRecord(payload);
    const action = asRecord(record?.action);
    return action?.actionId === input.expectedAction.actionId
      || record?.actionId === input.expectedAction.actionId;
  });
  if (matchingEvents.length === 0) {
    throw new Error("mission_repair_tool_action_request_missing");
  }
  if (matchingEvents.length !== 1) {
    throw new Error("mission_repair_tool_action_request_conflict");
  }

  const [event] = matchingEvents;
  const payloadRecord = asRecord(event?.payload);
  if (event?.actorType !== "worker" || payloadRecord?.invocationKind !== "candidate_overlay") {
    throw new Error("mission_repair_tool_action_request_conflict");
  }

  let requestedAction: AgentAction;
  try {
    requestedAction = parseAgentActionRequestedPayload(event.payload).action;
  } catch {
    throw new Error("mission_repair_tool_action_request_invalid");
  }
  if (canonicalJsonHash(requestedAction) !== canonicalJsonHash(input.expectedAction)) {
    throw new Error("mission_repair_tool_action_request_conflict");
  }
}