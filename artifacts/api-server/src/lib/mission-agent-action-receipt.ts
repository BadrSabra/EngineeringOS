import { and, eq, sql } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import type { EngineeringAgentActionResult } from "./engineering-agent-action.js";

export type MissionAgentActionReceiptIdentity = {
  eventId: string;
  projectId: string;
  correlationId: string;
  requestHash: string;
  claimId: string;
};

type MissionAgentActionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function storedEffectResult(result: EngineeringAgentActionResult): Record<string, unknown> {
  return {
    outcome: result.outcome,
    ...(result.operation ? { operation: result.operation } : {}),
    ...(result.run ? { run: result.run } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

/**
 * Bind a successful Mission action's recoverable result to its mutation
 * transaction. A gateway retry can then recover the outcome even if the
 * follow-up result-staging write never succeeds.
 */
export async function persistMissionAgentActionEffectReceipt(
  transaction: MissionAgentActionTransaction,
  identity: MissionAgentActionReceiptIdentity,
  result: EngineeringAgentActionResult,
): Promise<void> {
  const [event] = await transaction.select({ payload: eventsTable.payload })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.id, identity.eventId),
      eq(eventsTable.projectId, identity.projectId),
      eq(eventsTable.type, "AiMissionAgentActionRequested"),
      eq(eventsTable.correlationId, identity.correlationId),
      sql`${eventsTable.payload}->>'requestHash' = ${identity.requestHash}`,
      sql`${eventsTable.payload}->>'claimId' = ${identity.claimId}`,
      sql`${eventsTable.payload}->>'status' = 'processing'`,
    ))
    .for("update")
    .limit(1);
  const payload = jsonRecord(event?.payload);
  if (
    !payload
    || payload.requestHash !== identity.requestHash
    || payload.claimId !== identity.claimId
    || payload.status !== "processing"
  ) {
    throw new Error("Mission Agent action receipt lost its current reservation.");
  }

  const [updated] = await transaction.update(eventsTable)
    .set({
      payload: {
        ...payload,
        effectReceipt: storedEffectResult(result),
      },
    })
    .where(and(
      eq(eventsTable.id, identity.eventId),
      eq(eventsTable.projectId, identity.projectId),
      eq(eventsTable.type, "AiMissionAgentActionRequested"),
      eq(eventsTable.correlationId, identity.correlationId),
      sql`${eventsTable.payload}->>'requestHash' = ${identity.requestHash}`,
      sql`${eventsTable.payload}->>'claimId' = ${identity.claimId}`,
      sql`${eventsTable.payload}->>'status' = 'processing'`,
    ))
    .returning({ id: eventsTable.id });
  if (!updated) {
    throw new Error("Mission Agent action receipt could not be bound to its current reservation.");
  }
}
