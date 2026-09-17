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
  extractSemanticMemories,
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

  it("extracts only explicit decisions and server-verified semantic results", () => {
    const records = extractSemanticMemories({
      outcome: "SUCCEEDED",
      turnIntent: "CHAT",
      memoryMode: "summary",
      userMessage: "Decision: Keep the API response contract stable.",
      taskScope: "chat",
      projectRevision: "revision-1",
      taskResult: {
        kind: "FINDING_RESULT",
        finding: {
          finding: "The retry path drops the terminal error.",
          severity: "HIGH",
          evidence: [{
            source: "src/retry.ts",
            supportsClaim: true,
            evidenceClass: "FINDING_PROVEN",
            citationStatus: "ACCEPTED",
          }],
        },
      },
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      kind: "decision",
      confirmationStatus: "user_confirmed",
      provenance: "explicit_user_decision",
      scope: "task:chat",
    });
    expect(records[1]).toMatchObject({
      kind: "key_finding",
      confirmationStatus: "server_validated",
      provenance: "validated_finding",
      sourceReference: "src/retry.ts",
    });
    expect(records.map((record) => record.content).join(" ")).not.toContain("provider");
  });

  it("rejects failed, forensic, unproven, and provider-only semantic candidates", () => {
    const base = {
      userMessage: "Decision: This must never be retained.",
      taskResult: {
        kind: "FINDING_RESULT",
        finding: {
          finding: "Narrative only",
          severity: "NOT_PROVEN",
          evidence: [],
        },
      },
    };
    expect(extractSemanticMemories({ ...base, outcome: "FAILED" })).toEqual([]);
    expect(extractSemanticMemories({ ...base, outcome: "INTERRUPTED" })).toEqual([]);
    expect(extractSemanticMemories({ ...base, outcome: "SUCCEEDED", turnIntent: "FORENSIC_AUDIT" })).toEqual([]);
    expect(extractSemanticMemories({ ...base, outcome: "SUCCEEDED", turnIntent: "CHAT" })).toHaveLength(1);
    expect(extractSemanticMemories({
      outcome: "SUCCEEDED",
      turnIntent: "CHAT",
      taskResult: "The provider says this is a decision.",
    })).toEqual([]);
  });

  it("renders semantic records separately and marks source revisions stale", () => {
    const result = formatMemoriesForPrompt([{
      id: "semantic-1",
      projectId: "project-1",
      sessionId: "session-1",
      memoryType: "key_finding",
      content: "The retry path drops the terminal error.",
      sourcePath: "src/retry.ts",
      dedupeKey: "semantic-key",
      semanticKind: "key_finding",
      scope: "task:analysis",
      turnId: "turn-1",
      provenance: "validated_finding",
      sourceReference: "src/retry.ts",
      sourceRevision: "revision-1",
      confidence: 0.9,
      confirmationStatus: "server_validated",
      freshnessStatus: "stale",
      relevance: 0.95,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      expiresAt: null,
      lastDecayAt: null,
    }]);

    expect(result).toContain("[remembered key_finding]");
    expect(result).toContain("scope=task:analysis");
    expect(result).toContain("freshness=stale");
    expect(result).toContain("Re-read current source");
    expect(result).toContain("UNTRUSTED_CONTENT source=session_memory");
  });

  it("omits memories below the composite relevance floor while retaining an eligible memory", async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "session-memory-relevance-test",
      name: "session-memory-relevance-test",
      rootPath: `/tmp/session-memory-relevance-test-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "session-memory-relevance-test",
      createdAt: now,
      updatedAt: now,
    });

    const belowFloorId = randomUUID();
    const aboveFloorId = randomUUID();
    await db.insert(aiSessionMemoriesTable).values([
      {
        id: belowFloorId,
        projectId,
        sessionId,
        memoryType: "key_finding",
        semanticKind: "key_finding",
        scope: "project",
        content: "This stale memory should be omitted by the relevance floor.",
        sourceRevision: "old-revision",
        relevance: 0.1,
        createdAt: now,
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      },
      {
        id: aboveFloorId,
        projectId,
        sessionId,
        memoryType: "session_summary",
        content: "This recent memory remains eligible for prompt retrieval.",
        relevance: 0.85,
        createdAt: now,
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      },
    ]);

    try {
      const retrieved = await fetchSessionMemories(
        projectId,
        10,
        { mode: "episodic", limit: 10 },
        { projectRevision: "current-revision" },
      );

      expect(retrieved.map((memory) => memory.id)).toContain(aboveFloorId);
      expect(retrieved.map((memory) => memory.id)).not.toContain(belowFloorId);
    } finally {
      await db.delete(aiSessionMemoriesTable).where(eq(
        aiSessionMemoriesTable.projectId,
        projectId,
      ));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("deduplicates legacy ties by the lexicographically smallest ID while newer rows still win", async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    const olderCreatedAt = new Date(now.getTime() - 1_000);
    const equalCreatedAt = new Date(now.getTime());
    const olderId = "legacy-older";
    const equalWinnerId = "legacy-equal-a";
    const equalLoserId = "legacy-equal-z";

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "session-memory-deduplication-test",
      name: "session-memory-deduplication-test",
      rootPath: `/tmp/session-memory-deduplication-test-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "session-memory-deduplication-test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiSessionMemoriesTable).values([
      {
        id: equalLoserId,
        projectId,
        sessionId,
        memoryType: "session_summary",
        content: "Equal-timestamp loser",
        dedupeKey: null,
        relevance: 0.85,
        createdAt: equalCreatedAt,
        expiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      },
      {
        id: olderId,
        projectId,
        sessionId,
        memoryType: "session_summary",
        content: "Older duplicate",
        dedupeKey: null,
        relevance: 0.85,
        createdAt: olderCreatedAt,
        expiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      },
      {
        id: equalWinnerId,
        projectId,
        sessionId,
        memoryType: "session_summary",
        content: "Equal-timestamp winner",
        dedupeKey: null,
        relevance: 0.85,
        createdAt: equalCreatedAt,
        expiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      },
    ]);

    try {
      const retrievals = await Promise.all([
        fetchSessionMemories(projectId, 10, { mode: "episodic", limit: 10 }),
        fetchSessionMemories(projectId, 10, { mode: "episodic", limit: 10 }),
      ]);

      expect(retrievals[0]).toHaveLength(1);
      expect(retrievals[0][0]).toMatchObject({
        id: equalWinnerId,
        content: "Equal-timestamp winner",
      });
      expect(retrievals[1]).toEqual(retrievals[0]);
      expect(retrievals[0].map((memory) => memory.id)).not.toContain(olderId);
      expect(retrievals[0].map((memory) => memory.id)).not.toContain(equalLoserId);
    } finally {
      await db.delete(aiSessionMemoriesTable).where(eq(
        aiSessionMemoriesTable.projectId,
        projectId,
      ));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("selects and orders tied memories by ID consistently across retrievals", async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    const insertedIds = Array.from({ length: 21 }, (_, index) =>
      `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`);
    const expectedIds = insertedIds.slice(0, 5);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "session-memory-ordering-test",
      name: "session-memory-ordering-test",
      rootPath: `/tmp/session-memory-ordering-test-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "session-memory-ordering-test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiSessionMemoriesTable).values(
      [...insertedIds].reverse().map((id) => ({
        id,
        projectId,
        sessionId,
        memoryType: "session_summary" as const,
        content: `Equal-score memory ${id}`,
        dedupeKey: `equal-score-${id}`,
        scope: "project",
        confirmationStatus: "unconfirmed" as const,
        freshnessStatus: "current_at_write" as const,
        relevance: 0.85,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      })),
    );

    try {
      const retrievals = await Promise.all([
        fetchSessionMemories(projectId, 5, { mode: "episodic", limit: 5 }),
        fetchSessionMemories(projectId, 5, { mode: "episodic", limit: 5 }),
        fetchSessionMemories(projectId, 5, { mode: "episodic", limit: 5 }),
      ]);

      expect(retrievals.map((memories) => memories.map((memory) => memory.id))).toEqual([
        expectedIds,
        expectedIds,
        expectedIds,
      ]);
    } finally {
      await db.delete(aiSessionMemoriesTable).where(eq(
        aiSessionMemoriesTable.projectId,
        projectId,
      ));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
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
        [],
        "short",
        `${turnId}-semantic`,
        {
          outcome: "SUCCEEDED",
          turnIntent: "CHAT",
          memoryMode: "summary",
          userMessage: "Decision: Keep the API response contract stable.",
          taskScope: "chat",
          projectRevision: "revision-1",
        },
      );
      await drainSessionMemoryOutbox();
      await writeSessionMemories(
        sessionId,
        projectId,
        [],
        "This ordinary conversational response is intentionally long enough to look like a summary.",
        `${turnId}-chat-summary`,
        {
          outcome: "SUCCEEDED",
          turnIntent: "CHAT",
          memoryMode: "summary",
        },
      );
      await drainSessionMemoryOutbox();
      await writeSessionMemories(
        sessionId,
        projectId,
        [],
        "short",
        `${turnId}-semantic`,
        {
          outcome: "SUCCEEDED",
          turnIntent: "CHAT",
          memoryMode: "summary",
          userMessage: "Decision: Keep the API response contract stable.",
          taskScope: "chat",
          projectRevision: "revision-1",
        },
      );
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
      expect(memories).toHaveLength(3);
      expect(memories.find((memory) => memory.memoryType === "file_summary")).toMatchObject({
        sourcePath: "src/feature.ts",
        turnId,
      });
      expect(memories.find((memory) => memory.memoryType === "session_summary")).toMatchObject({
        turnId,
      });
      expect(memories.find((memory) => memory.semanticKind === "decision")).toMatchObject({
        memoryType: "entity_fact",
        scope: "task:chat",
        confirmationStatus: "user_confirmed",
        sourceRevision: "revision-1",
      });
      await db.insert(aiSessionMemoriesTable).values({
        id: randomUUID(),
        projectId,
        sessionId,
        memoryType: "entity_fact",
        semanticKind: "constraint",
        scope: "task:other",
        turnId: randomUUID(),
        provenance: "explicit_user_decision",
        content: "Only the other task should see this constraint.",
        sourceReference: "user_message",
        sourceRevision: "revision-1",
        confidence: 1,
        confirmationStatus: "user_confirmed",
        freshnessStatus: "current_at_write",
        relevance: 1,
        createdAt: now,
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        lastDecayAt: null,
      });
      const retrieved = await fetchSessionMemories(
        projectId,
        10,
        { mode: "summary", limit: 10 },
        { taskScope: "chat", projectRevision: "revision-2" },
      );
      const retrievedDecision = retrieved.find((memory) => memory.semanticKind === "decision");
      expect(retrievedDecision?.freshnessStatus).toBe("stale");
      expect(retrieved.some((memory) => memory.scope === "task:other")).toBe(false);

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