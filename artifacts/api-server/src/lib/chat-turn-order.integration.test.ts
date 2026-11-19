import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";
import {
  aiChatMessagesTable,
  aiChatSessionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { reservePersistedChatTurnTimestamps } from "./chat-turn-order.js";

type WorkerInput = {
  sessionId: string;
  projectId: string;
  userId: string;
  label: string;
  clockSkewMs: number;
  holdUntilReleased: boolean;
};

type WorkerReservation = {
  kind: "reserved";
  label: string;
  startedAt: string;
  assistantAt: string;
  applicationNowMs: number;
};

type WorkerHandle = {
  child: ChildProcessWithoutNullStreams;
  reserved: Promise<WorkerReservation>;
  exited: Promise<{ code: number | null; stderr: string }>;
  getStderr: () => string;
};

const apiServerRoot = fileURLToPath(new URL("../../", import.meta.url));
const workerPath = fileURLToPath(new URL("../../scripts/chat-turn-order-worker.ts", import.meta.url));
const childProcesses: ChildProcessWithoutNullStreams[] = [];
const cleanupSessions: string[] = [];
const cleanupProjects: string[] = [];

function startWorker(input: WorkerInput): WorkerHandle {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", workerPath, JSON.stringify(input)],
    {
      cwd: apiServerRoot,
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  childProcesses.push(child);

  let stdoutBuffer = "";
  let stderr = "";
  let reservationSeen = false;
  let resolveReserved!: (value: WorkerReservation) => void;
  let rejectReserved!: (error: Error) => void;
  const reserved = new Promise<WorkerReservation>((resolve, reject) => {
    resolveReserved = resolve;
    rejectReserved = reject;
  });
  // Avoid an unhandled-rejection window when a worker fails before the caller
  // reaches the reservation assertion.
  void reserved.catch(() => undefined);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        const value = JSON.parse(line) as WorkerReservation;
        if (value.kind === "reserved" && !reservationSeen) {
          reservationSeen = true;
          resolveReserved(value);
        }
      } catch {
        // Ignore non-JSON diagnostic output; stderr is retained separately.
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });

  const exited = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.once("error", (error) => {
      if (!reservationSeen) rejectReserved(error);
      stderr += error.message;
    });
    child.once("exit", (code) => {
      if (!reservationSeen) {
        rejectReserved(new Error(
          "Chat turn worker exited before reserving a turn: " + stderr,
        ));
      }
      resolve({ code, stderr });
    });
  });

  return {
    child,
    reserved,
    exited,
    getStderr: () => stderr,
  };
}

async function insertProjectAndSession(): Promise<{
  projectId: string;
  sessionId: string;
  ownerId: string;
}> {
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const ownerId = "chat-turn-order-owner-" + randomUUID();
  cleanupProjects.push(projectId);
  cleanupSessions.push(sessionId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId,
    name: "Chat turn ordering fixture",
    rootPath: "/tmp/chat-turn-order-" + projectId,
    language: "typescript",
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Chat turn ordering fixture",
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    updatedAt: new Date("2020-01-01T00:00:00.000Z"),
  });

  return { projectId, sessionId, ownerId };
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
  }
  for (const sessionId of cleanupSessions.splice(0)) {
    await db.delete(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .catch(() => undefined);
  }
  for (const projectId of cleanupProjects.splice(0)) {
    await db.delete(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .catch(() => undefined);
  }
});

describe("database-authoritative chat turn ordering", () => {
  it("serializes independent API processes despite opposite clock skew and late completion", async () => {
    const fixture = await insertProjectAndSession();

    const older = startWorker({
      sessionId: fixture.sessionId,
      projectId: fixture.projectId,
      userId: fixture.ownerId,
      label: "older",
      // The earlier request's application clock is 24 hours ahead.
      clockSkewMs: 24 * 60 * 60 * 1000,
      holdUntilReleased: true,
    });
    const olderReservation = await older.reserved;

    const newer = startWorker({
      sessionId: fixture.sessionId,
      projectId: fixture.projectId,
      userId: fixture.ownerId,
      label: "newer",
      // The later request's application clock is 24 hours behind.
      clockSkewMs: -24 * 60 * 60 * 1000,
      holdUntilReleased: false,
    });
    const newerReservation = await newer.reserved;
    const newerExit = await newer.exited;
    expect(newerExit.code, newerExit.stderr).toBe(0);

    // Let the older provider turn finish only after the newer turn has
    // committed its messages and resumable state.
    older.child.stdin.end("finish\n");
    const olderExit = await older.exited;
    expect(olderExit.code, olderExit.stderr).toBe(0);

    expect(olderReservation.applicationNowMs)
      .toBeGreaterThan(newerReservation.applicationNowMs);
    expect(Date.parse(newerReservation.startedAt))
      .toBeGreaterThan(Date.parse(olderReservation.startedAt));
    expect(Date.parse(olderReservation.assistantAt))
      .toBeLessThan(Date.parse(newerReservation.startedAt));

    const messages = await db
      .select({ role: aiChatMessagesTable.role, content: aiChatMessagesTable.content })
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, fixture.sessionId))
      .orderBy(asc(aiChatMessagesTable.createdAt), asc(aiChatMessagesTable.id));

    expect(messages.map((message) => message.content)).toEqual([
      "older:user",
      "older:assistant",
      "newer:user",
      "newer:assistant",
    ]);

    const [session] = await db
      .select({ activeTaskState: aiChatSessionsTable.activeTaskState })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, fixture.sessionId));
    expect(JSON.parse(session!.activeTaskState!)).toMatchObject({ marker: "newer" });
  });

  it("does not reserve missing, foreign-project, or foreign-owner sessions", async () => {
    const fixture = await insertProjectAndSession();
    const [before] = await db
      .select({ updatedAt: aiChatSessionsTable.updatedAt })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, fixture.sessionId));

    await expect(reservePersistedChatTurnTimestamps({
      sessionId: randomUUID(),
      projectId: fixture.projectId,
      userId: fixture.ownerId,
    })).resolves.toBeUndefined();

    await expect(reservePersistedChatTurnTimestamps({
      sessionId: fixture.sessionId,
      projectId: randomUUID(),
      userId: fixture.ownerId,
    })).resolves.toBeUndefined();

    await expect(reservePersistedChatTurnTimestamps({
      sessionId: fixture.sessionId,
      projectId: fixture.projectId,
      userId: "different-owner",
    })).resolves.toBeUndefined();

    const [after] = await db
      .select({ updatedAt: aiChatSessionsTable.updatedAt })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, fixture.sessionId));
    expect(after!.updatedAt).toEqual(before!.updatedAt);
  });
});
