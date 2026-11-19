import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  aiChatMessagesTable,
  aiChatSessionsTable,
  db,
  pool,
} from "@workspace/db";
import {
  reservePersistedChatTurnTimestamps,
  sessionTaskStateIsAtOrBefore,
} from "../src/lib/chat-turn-order.js";

type WorkerInput = {
  sessionId: string;
  projectId: string;
  userId: string;
  label: string;
  clockSkewMs: number;
  holdUntilReleased: boolean;
};

function readInput(): WorkerInput {
  const raw = process.argv[2];
  if (!raw) throw new Error("Missing chat turn worker input");
  const value = JSON.parse(raw) as WorkerInput;
  if (
    !value.sessionId
    || !value.projectId
    || !value.userId
    || !value.label
    || !Number.isFinite(value.clockSkewMs)
  ) {
    throw new Error("Invalid chat turn worker input");
  }
  return value;
}

async function waitForRelease(): Promise<void> {
  await new Promise<void>((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      input += chunk;
      if (input.includes("finish")) resolve();
    });
  });
}

async function run(): Promise<void> {
  const input = readInput();
  const wallClockNow = Date.now.bind(Date);
  // Simulate independently skewed API process clocks. The production
  // reservation must use PostgreSQL time and the persisted row, not this clock.
  Date.now = () => wallClockNow() + input.clockSkewMs;

  const timestamps = await reservePersistedChatTurnTimestamps({
    sessionId: input.sessionId,
    projectId: input.projectId,
    userId: input.userId,
  });
  if (!timestamps) {
    throw new Error("The owner-scoped chat turn reservation was not found");
  }

  process.stdout.write(JSON.stringify({
    kind: "reserved",
    label: input.label,
    startedAt: timestamps.startedAt.toISOString(),
    assistantAt: timestamps.assistantAt.toISOString(),
    applicationNowMs: Date.now(),
  }) + "\n");

  if (input.holdUntilReleased) await waitForRelease();

  const activeTaskState = JSON.stringify({
    marker: input.label,
    lastProgressAt: timestamps.assistantAt.toISOString(),
  });

  const applied = await db.transaction(async (tx) => {
    await tx.insert(aiChatMessagesTable).values([
      {
        id: randomUUID(),
        sessionId: input.sessionId,
        role: "user",
        content: input.label + ":user",
        createdAt: timestamps.startedAt,
      },
      {
        id: randomUUID(),
        sessionId: input.sessionId,
        role: "assistant",
        content: input.label + ":assistant",
        createdAt: timestamps.assistantAt,
      },
    ]);

    const updated = await tx
      .update(aiChatSessionsTable)
      .set({
        activeTaskState,
        updatedAt: sql`GREATEST(
          ${aiChatSessionsTable.updatedAt},
          ${timestamps.assistantAt}
        )`,
      })
      .where(and(
        eq(aiChatSessionsTable.id, input.sessionId),
        eq(aiChatSessionsTable.projectId, input.projectId),
        sessionTaskStateIsAtOrBefore(timestamps.assistantAt),
      ))
      .returning({ id: aiChatSessionsTable.id });

    return updated.length > 0;
  });

  process.stdout.write(JSON.stringify({
    kind: "completed",
    label: input.label,
    sessionStateApplied: applied,
  }) + "\n");
}

try {
  await run();
} catch (error) {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
