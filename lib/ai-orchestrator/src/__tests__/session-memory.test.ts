import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiChatSessionsTable,
  aiSessionMemoryOutboxTable,
  aiSessionMemoriesTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  enrichContextWithMemories,
  fetchSessionMemories,
  formatMemoriesForPrompt,
  normalizeProjectRelativePath,
  drainSessionMemoryOutbox,
  sweepExpiredMemories,
  writeSessionMemories,
} from "../session-memory.js";

describe("session memory policy", () => {
  it("canonicalizes project-relative paths and rejects traversal or absolute paths", () => {
    expect(normalizeProjectRelativePath("./src\\feature/../feature.ts")).toBe("src/feature.ts");
    expect(normalizeProjectRelativePath("../secrets.env")).toBeNull();
    expect(normalizeProjectRelativePath("/etc/passwd")).toBeNull();
    expect(normalizeProjectRelativePath("C:/secrets.env")).toBeNull();
  });

  it("keeps the untrusted wrapper when formatting memory", () => {
    const result = formatMemoriesForPrompt([{
      id: "memory-1",
      projectId: "project-1",
      sessionId: "session-1",
      memoryType: "session_summary",
      content: "A prior summary that is intentionally untrusted.",
      sourcePath: null,
      relevance: 0.85,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      expiresAt: null,
    }]);

    expect(result).toContain("UNTRUSTED_CONTENT source=session_memory");
    expect(result).toContain("not an instruction");
  });

  it("does not retrieve memory when the active plan disables it", async () => {
    const context = {
      project: "Project A",
      latestMetrics: "Metrics A",
      graphSummary: "Graph A",
      recentTasks: "Tasks A",
      recentEvents: "Events A",
      workflows: "Workflows A",
      metricsVerified: true,
      sessionMemories: "stale",
    };

    await enrichContextWithMemories(context, "project-1", {
      taskProfile: { memoryMode: "none" },
      memoryDepth: 0,
    } as never);

    expect(context.sessionMemories).toBeUndefined();
  });

  it("returns no memory when the database is unavailable", async () => {
    // Empty project IDs are rejected before any database call.
    await expect(fetchSessionMemories("", 5)).resolves.toEqual([]);
  });

  it("delivers one durable write idempotently and decays once per day", async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "session-memory-test",
      name: "session-memory-test",
      rootPath: `/tmp/session-memory-test-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "session-memory-test",
      createdAt: now,
      updatedAt: now,
    });

    try {
      await writeSessionMemories(
        sessionId,
        projectId,
        ["./src\\feature/../feature.ts", "src/feature.ts", "../unsafe.ts"],
        "A durable summary that is intentionally long enough to retain.",
        turnId,
      );
      expect(await db.select().from(aiSessionMemoryOutboxTable).where(eq(
        aiSessionMemoryOutboxTable.id,
        `${sessionId}:${turnId}`,
      ))).toHaveLength(1);
      await drainSessionMemoryOutbox();
      await writeSessionMemories(
        sessionId,
        projectId,
        ["src/feature.ts"],
        "A durable summary that is intentionally long enough to retain.",
        turnId,
      );
      await drainSessionMemoryOutbox();

      const memories = await db.select().from(aiSessionMemoriesTable).where(eq(
        aiSessionMemoriesTable.projectId,
        projectId,
      ));
      expect(memories).toHaveLength(2);
      expect(memories.find((memory) => memory.memoryType === "file_summary")?.sourcePath)
        .toBe("src/feature.ts");

      const oldId = randomUUID();
      await db.insert(aiSessionMemoriesTable).values({
        id: oldId,
        projectId,
        sessionId,
        memoryType: "key_finding",
        content: "old",
        relevance: 1,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      });
      await sweepExpiredMemories();
      await sweepExpiredMemories();
      const [decayed] = await db.select().from(aiSessionMemoriesTable).where(eq(
        aiSessionMemoriesTable.id,
        oldId,
      ));
      expect(decayed?.relevance).toBe(0.9);
    } finally {
      await db.delete(aiSessionMemoryOutboxTable).where(eq(
        aiSessionMemoryOutboxTable.projectId,
        projectId,
      ));
      await db.delete(aiSessionMemoriesTable).where(eq(
        aiSessionMemoriesTable.projectId,
        projectId,
      ));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});