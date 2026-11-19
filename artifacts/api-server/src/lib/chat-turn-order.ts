import { and, eq, sql } from "drizzle-orm";
import { db, aiChatSessionsTable, projectsTable } from "@workspace/db";

export type ChatTurnTimestamps = {
  startedAt: Date;
  assistantAt: Date;
};

/**
 * Reserve a turn's admission order on the persisted session row.
 *
 * PostgreSQL serializes concurrent UPDATEs for the same row across API
 * processes. The monotonic expression also survives a backward database-clock
 * adjustment because it never moves behind the row's prior updated_at value.
 * The owner/project/session predicates are part of the UPDATE itself, so an
 * unauthorized request cannot mutate a foreign session while it is being
 * checked.
 */
export async function reservePersistedChatTurnTimestamps(params: {
  projectId: string;
  sessionId: string;
  userId?: string;
}): Promise<ChatTurnTimestamps | undefined> {
  if (!params.userId) return undefined;

  const [reservation] = await db
    .update(aiChatSessionsTable)
    .set({
      updatedAt: sql<Date>`GREATEST(
        clock_timestamp() AT TIME ZONE 'UTC',
        ${aiChatSessionsTable.updatedAt} + interval '2 milliseconds'
      )`,
    })
    .where(and(
      eq(aiChatSessionsTable.id, params.sessionId),
      eq(aiChatSessionsTable.projectId, params.projectId),
      sql`EXISTS (
        SELECT 1
        FROM ${projectsTable}
        WHERE ${projectsTable.id} = ${aiChatSessionsTable.projectId}
          AND ${projectsTable.ownerId} = ${params.userId}
      )`,
    ))
    .returning({ startedAt: aiChatSessionsTable.updatedAt });

  if (!reservation?.startedAt) return undefined;

  return {
    startedAt: reservation.startedAt,
    // Keep the assistant row inside this reservation's two-millisecond
    // window so it always sorts after its user row and before the next turn.
    assistantAt: new Date(reservation.startedAt.getTime() + 1),
  };
}

let lastUnboundTurnTimestamp = 0;

/**
 * A process-local fallback is only for requests that do not yet target a
 * persisted session. Those requests create a new, server-generated session ID
 * and therefore cannot race to write into a shared existing session.
 */
export function allocateUnboundChatTurnTimestamps(): ChatTurnTimestamps {
  const startedAtMs = Math.max(Date.now(), lastUnboundTurnTimestamp + 2);
  lastUnboundTurnTimestamp = startedAtMs;
  return {
    startedAt: new Date(startedAtMs),
    assistantAt: new Date(startedAtMs + 1),
  };
}

/**
 * Keep the last-progress and session-row fences on the UPDATE itself. A
 * request that reserved an older ticket must not overwrite a later admission,
 * even when its provider call finishes last.
 */
export function sessionTaskStateIsAtOrBefore(msgNow: Date) {
  return sql`COALESCE(
    NULLIF(${aiChatSessionsTable.activeTaskState}::jsonb->>'lastProgressAt', '')::timestamptz,
    ${aiChatSessionsTable.updatedAt}
  ) <= ${msgNow}
  AND ${aiChatSessionsTable.updatedAt} <= ${msgNow}`;
}
