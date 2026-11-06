import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db, pool, projectsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import {
  reportDeadRootPaths,
  retainHistoricalCheckpoint,
  retainHistoricalValidationMetadata,
  scrubHistoricalValidationRecord,
  getAiDiagnosticsRetentionHealth,
  getStartupMaintenanceReadiness,
  ensureEncryptionKey,
  pruneHistoricalAiDiagnostics,
  scrubHistoricalValidationDetails,
  STARTUP_MAINTENANCE_BATCH_SIZE,
} from "./startup-migrations";

type FakeQueryResult = { rows: Record<string, unknown>[]; rowCount: number };
type FakeQuery = (sql: string, values?: unknown[]) => Promise<FakeQueryResult>;

function makeMaintenanceClient(query: FakeQuery): PoolClient {
  return {
    query: vi.fn(query),
    release: vi.fn(),
  } as unknown as PoolClient;
}

async function insertProject(rootPath: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `startup-mig-${id.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("ensureEncryptionKey", () => {
  it("rejects a configured value with the right length but invalid hex", async () => {
    const previous = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    const invalidKey = "g".repeat(64);
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = invalidKey;
    try {
      await ensureEncryptionKey();
      expect(process.env.AI_CREDENTIALS_ENCRYPTION_KEY).toBe(invalidKey);
    } finally {
      if (previous === undefined) {
        delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
      } else {
        process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    }
  });
});

describe("reportDeadRootPaths — never rebinds a dead root", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await db.delete(projectsTable).where(eq(projectsTable.id, id));
    }
  });

  it("leaves a dead /tmp/eos-git-* rootPath untouched (no workspace rebinding)", async () => {
    const deadRoot = `/tmp/eos-git-${randomUUID()}`; // never exists on disk
    const projectId = await insertProject(deadRoot);
    cleanupQueue.push(projectId);

    await reportDeadRootPaths();

    const row = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(row[0]?.rootPath).toBe(deadRoot);
    expect(row[0]?.rootPath).not.toBe("/home/runner/workspace");
  });

  it("leaves valid roots and non-git roots untouched", async () => {
    const validRoot = `/home/runner/workspace/.test-roots/mig-${randomUUID()}`;
    const projectId = await insertProject(validRoot);
    cleanupQueue.push(projectId);

    await expect(reportDeadRootPaths()).resolves.toBeUndefined();

    const row = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(row[0]?.rootPath).toBe(validRoot);
  });

  it("is idempotent — safe to run repeatedly", async () => {
    const deadRoot = `/tmp/eos-git-${randomUUID()}`;
    const projectId = await insertProject(deadRoot);
    cleanupQueue.push(projectId);

    await reportDeadRootPaths();
    await reportDeadRootPaths();

    const row = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(row[0]?.rootPath).toBe(deadRoot);
  });
});

describe("scrubHistoricalValidationRecord", () => {
  it("keeps proof and exit metadata while removing legacy validation diagnostics", () => {
    const scrubbed = scrubHistoricalValidationRecord({
      kind: "validation",
      repairState: "BLOCKED",
      attempt: 2,
      maxAttempts: 3,
      validation: {
        profile: "workspace-typecheck",
        status: "failed",
        scenario: "typecheck",
        exitCode: 1,
        command: "pnpm test --filter private",
        stdout: "PRIVATE_SOURCE=must-not-persist",
        stderr: "secret@example.com",
        failedTests: [{ name: "private.test.ts", message: "source details" }],
        changedFiles: ["src/private.ts"],
        evidence: {
          evidenceId: "validation-result:1",
          observedAt: "2026-08-22T00:00:00.000Z",
          artifactRef: "validation-result:1",
          rawDiagnostic: "must-not-persist",
          nestedPrivateData: { secret: "must-not-persist" },
        },
      },
    }) as Record<string, unknown>;

    expect(scrubbed).toEqual({
      kind: "validation",
      repairState: "BLOCKED",
      attempt: 2,
      maxAttempts: 3,
      validation: {
        profile: "workspace-typecheck",
        status: "failed",
        scenario: "typecheck",
        exitCode: 1,
        evidence: {
          evidenceId: "validation-result:1",
          observedAt: "2026-08-22T00:00:00.000Z",
          artifactRef: "validation-result:1",
        },
      },
    });
  });

  it("drops malformed evidence fields while preserving safe identifiers", () => {
    const scrubbed = scrubHistoricalValidationRecord({
      kind: "validation",
      validation: {
        status: "failed",
        evidence: {
          evidenceId: "evidence-1",
          observedAt: "not-a-timestamp",
          artifactRef: "validation-attempt:evidence-1",
          rawDiagnostic: "must-not-persist",
        },
      },
    });

    expect(scrubbed).toEqual({
      kind: "validation",
      validation: {
        status: "failed",
        evidence: {
          evidenceId: "evidence-1",
          artifactRef: "validation-attempt:evidence-1",
        },
      },
    });
  });

  it("projects legacy flattened fields and strips their diagnostic payload", () => {
    const scrubbed = scrubHistoricalValidationRecord({
      kind: "validation",
      validationStatus: "passed",
      validationProfile: "api-ai-tests",
      validationScenario: "focused tests",
      validationExitCode: 0,
      validationCommand: "pnpm test",
      validationFailedTests: ["secret test output"],
      validationAffectedFiles: ["src/private.ts"],
      validationDetail: "raw command output",
    }) as Record<string, unknown>;

    expect(scrubbed).toEqual({
      kind: "validation",
      validation: {
        profile: "api-ai-tests",
        status: "passed",
        scenario: "focused tests",
        exitCode: 0,
      },
    });
  });

  it("preserves typed operation acceptance checks while scrubbing validation results", () => {
    const scrubbed = scrubHistoricalValidationRecord({
      operation: {
        acceptanceChecks: [{
          id: "validation-passed",
          kind: "validation",
          description: "Registered validation passes for the approved scope.",
          required: true,
          command: "must-not-persist",
        }],
      },
      validationResult: {
        kind: "validation",
        status: "failed",
        exitCode: 1,
        command: "private test command",
        stdout: "raw validation output",
      },
    });

    expect(scrubbed).toEqual({
      operation: {
        acceptanceChecks: [{
          id: "validation-passed",
          kind: "validation",
          description: "Registered validation passes for the approved scope.",
          required: true,
        }],
      },
      validationResult: {
        kind: "validation",
        validation: {
          status: "failed",
          exitCode: 1,
        },
      },
    });
  });

  it("recursively scrubs validation steps without changing unrelated trace entries", () => {
    const scrubbed = scrubHistoricalValidationRecord([
      { kind: "tool_result", tool: "read_file", resultSummary: "safe summary" },
      { kind: "validation", status: "passed", exitCode: 0, command: "pnpm test", stdout: "raw" },
    ]);

    expect(scrubbed).toEqual([
      { kind: "tool_result", tool: "read_file", resultSummary: "safe summary" },
      { kind: "validation", validation: { status: "passed", exitCode: 0 } },
    ]);
  });
});

describe("historical AI diagnostic retention", () => {
  it("reports a successful bounded no-op batch", async () => {
    const runAt = new Date("2026-08-22T00:00:00.000Z");
    const client = makeMaintenanceClient(async (sql) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, tool_trace AS payload")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT id, checkpoint AS payload")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const connect = vi.spyOn(pool, "connect").mockImplementation(async () => client);
    const query = vi.spyOn(pool, "query").mockResolvedValue({
      rows: [
        "scrub_chat_validation_v2",
        "scrub_execution_validation_v2",
        "prune_chat_diagnostics_v2",
        "prune_execution_diagnostics_v2",
      ].map((maintenance_key) => ({ maintenance_key })),
      rowCount: 4,
    } as never);
    try {
      await expect(pruneHistoricalAiDiagnostics(runAt)).resolves.toBe(true);
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }

    expect(getAiDiagnosticsRetentionHealth()).toEqual({
      status: "success",
      attemptedAt: runAt.toISOString(),
      completedAt: runAt.toISOString(),
      chatRowsScanned: expect.any(Number),
      chatRowsPruned: expect.any(Number),
      executionRowsScanned: expect.any(Number),
      executionRowsPruned: expect.any(Number),
    });
  });

  it("reports a failed sweep without exposing the error and leaves it retryable", async () => {
    const connect = vi.spyOn(pool, "connect").mockRejectedValueOnce(new Error("database details"));
    const runAt = new Date("2026-08-22T01:00:00.000Z");
    const previousHealth = getAiDiagnosticsRetentionHealth();

    await expect(pruneHistoricalAiDiagnostics(runAt)).resolves.toBe(false);

    expect(getAiDiagnosticsRetentionHealth()).toMatchObject({
      status: "failed",
      attemptedAt: runAt.toISOString(),
      completedAt: previousHealth.completedAt,
      chatRowsScanned: previousHealth.chatRowsScanned,
      chatRowsPruned: previousHealth.chatRowsPruned,
      executionRowsScanned: previousHealth.executionRowsScanned,
      executionRowsPruned: previousHealth.executionRowsPruned,
    });
    expect(JSON.stringify(getAiDiagnosticsRetentionHealth())).not.toContain("database details");
    connect.mockRestore();
  });

  it("keeps malformed diagnostic rows out of completed batches", async () => {
    const now = new Date("2026-08-22T01:30:00.000Z");
    const chatCursorUpdates: unknown[][] = [];
    const chatClient = makeMaintenanceClient(async (sql, values) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, tool_trace AS payload")) {
        return {
          rows: [{ id: "malformed-diagnostic-row", payload: "{not-json", cursor_at: now }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE startup_maintenance_state")) {
        chatCursorUpdates.push(values ?? []);
      }
      return { rows: [], rowCount: 1 };
    });
    const executionClient = makeMaintenanceClient(async (sql) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, checkpoint AS payload")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const clients = [chatClient, executionClient];
    const connect = vi.spyOn(pool, "connect").mockImplementation(async () => {
      const client = clients.shift();
      if (!client) throw new Error("unexpected_extra_connection");
      return client;
    });
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const previousHealth = getAiDiagnosticsRetentionHealth();
    try {
      await expect(pruneHistoricalAiDiagnostics(now)).resolves.toBe(false);
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }
    expect(chatCursorUpdates).toContainEqual([
      "prune_chat_diagnostics_v2",
      null,
      null,
      false,
    ]);
    expect(getAiDiagnosticsRetentionHealth()).toMatchObject({
      status: "failed",
      completedAt: previousHealth.completedAt,
    });
  });

  it("does not advance diagnostics cursors after compare-and-set conflicts", async () => {
    const now = new Date("2026-08-22T02:00:00.000Z");
    const recent = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    const chatCursorUpdates: unknown[][] = [];
    const executionCursorUpdates: unknown[][] = [];
    const chatClient = makeMaintenanceClient(async (sql, values) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, tool_trace AS payload")) {
        return {
          rows: [{
            id: "chat-row",
            payload: JSON.stringify([{ kind: "private", text: "trace" }]),
            cursor_at: recent,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE ai_chat_messages")) return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE startup_maintenance_state")) {
        chatCursorUpdates.push(values ?? []);
      }
      return { rows: [], rowCount: 1 };
    });
    const executionClient = makeMaintenanceClient(async (sql, values) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, checkpoint AS payload")) {
        return {
          rows: [{
            id: "execution-row",
            payload: JSON.stringify({
              stage: "failed",
              sequence: 42,
              evidenceVerdict: "BLOCKED",
              detail: "private checkpoint details",
              recentSteps: [
                { kind: "tool_result", result: "private source" },
                { kind: "validation", status: "failed", exitCode: 2, stdout: "private output" },
              ],
            }),
            cursor_at: recent,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE ai_executions")) return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE startup_maintenance_state")) {
        executionCursorUpdates.push(values ?? []);
      }
      return { rows: [], rowCount: 1 };
    });
    const clients = [chatClient, executionClient];
    const connect = vi.spyOn(pool, "connect").mockImplementation(async () => {
      const client = clients.shift();
      if (!client) throw new Error("unexpected_extra_connection");
      return client;
    });
    const query = vi.spyOn(pool, "query").mockResolvedValue({
      rows: [
        "scrub_chat_validation_v2",
        "scrub_execution_validation_v2",
      ].map((maintenance_key) => ({ maintenance_key })),
      rowCount: 4,
    } as never);
    const previousHealth = getAiDiagnosticsRetentionHealth();
    try {
      await expect(pruneHistoricalAiDiagnostics(now)).resolves.toBe(false);
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }
    expect(chatCursorUpdates).toContainEqual([
      "prune_chat_diagnostics_v2",
      null,
      null,
      false,
    ]);
    expect(executionCursorUpdates).toContainEqual([
      "prune_execution_diagnostics_v2",
      null,
      null,
      false,
    ]);
    const health = getAiDiagnosticsRetentionHealth();
    expect(health.chatRowsPruned - previousHealth.chatRowsPruned).toBe(0);
    expect(health.executionRowsPruned - previousHealth.executionRowsPruned).toBe(0);
  });

  it("limits scrub batches and resumes from the durable cursor", async () => {
    const scannedIds: string[][] = [];
    const updateCursors: unknown[][] = [];
    let chatReads = 0;
    const client = makeMaintenanceClient(async (sql, values) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        const key = values?.[0];
        if (key === "scrub_chat_validation_v2" && chatReads > 0) {
          return {
            rows: [{ cursor_at: null, cursor_id: "chat-0200", completed_at: null }],
            rowCount: 1,
          };
        }
        if (key === "scrub_execution_validation_v2" && chatReads > 0) {
          return {
            rows: [{ cursor_at: null, cursor_id: null, completed_at: new Date() }],
            rowCount: 1,
          };
        }
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, tool_trace AS payload")) {
        chatReads++;
        const ids = chatReads === 1
          ? Array.from({ length: STARTUP_MAINTENANCE_BATCH_SIZE }, (_, index) =>
              `chat-${String(index + 1).padStart(4, "0")}`,
            )
          : [];
        scannedIds.push(ids);
        return {
          rows: ids.map((id) => ({ id, payload: "{}" })),
          rowCount: ids.length,
        };
      }
      if (sql.includes("UPDATE startup_maintenance_state")) updateCursors.push(values ?? []);
      if (sql.includes("SELECT id, checkpoint AS payload")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const connect = vi.spyOn(pool, "connect").mockImplementation(async () => client);
    const query = vi.spyOn(pool, "query").mockResolvedValue({
      rows: [
        "scrub_chat_validation_v2",
        "scrub_execution_validation_v2",
        "prune_chat_diagnostics_v2",
        "prune_execution_diagnostics_v2",
      ].map((maintenance_key) => ({ maintenance_key })),
      rowCount: 4,
    } as never);
    try {
      await expect(scrubHistoricalValidationDetails()).resolves.toBe(false);
      await expect(scrubHistoricalValidationDetails()).resolves.toBe(true);
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }
    expect(scannedIds[0]).toHaveLength(STARTUP_MAINTENANCE_BATCH_SIZE);
    expect(scannedIds[1]).toEqual([]);
    expect(updateCursors).toContainEqual([
      "scrub_chat_validation_v2",
      `chat-${String(STARTUP_MAINTENANCE_BATCH_SIZE).padStart(4, "0")}`,
      false,
    ]);
  });

  it("does not complete or advance past a malformed historical payload", async () => {
    const chatCursorUpdates: unknown[][] = [];
    const chatClient = makeMaintenanceClient(async (sql, values) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, tool_trace AS payload")) {
        return { rows: [{ id: "malformed-chat-row", payload: "{not-json" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE startup_maintenance_state")) {
        chatCursorUpdates.push(values ?? []);
      }
      return { rows: [], rowCount: 1 };
    });
    const executionClient = makeMaintenanceClient(async (sql) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, checkpoint AS payload")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const clients = [chatClient, executionClient];
    const connect = vi.spyOn(pool, "connect").mockImplementation(async () => {
      const client = clients.shift();
      if (!client) throw new Error("unexpected_extra_connection");
      return client;
    });
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [], rowCount: 0 } as never);
    try {
      await expect(scrubHistoricalValidationDetails()).resolves.toBe(false);
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }
    expect(chatCursorUpdates).toContainEqual([
      "scrub_chat_validation_v2",
      null,
      false,
    ]);
    expect(getStartupMaintenanceReadiness()).toEqual({
      status: "blocked",
      reason: "historical_maintenance_in_progress",
    });
  });

  it("retries a scrub row after a compare-and-set conflict", async () => {
    const chatCursorUpdates: unknown[][] = [];
    const chatClient = makeMaintenanceClient(async (sql, values) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, tool_trace AS payload")) {
        return {
          rows: [{
            id: "racing-chat-row",
            payload: JSON.stringify({
              kind: "validation",
              validation: { status: "failed", stdout: "private output" },
            }),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE ai_chat_messages")) return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE startup_maintenance_state")) {
        chatCursorUpdates.push(values ?? []);
      }
      return { rows: [], rowCount: 1 };
    });
    const executionClient = makeMaintenanceClient(async (sql) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM startup_maintenance_state")) {
        return { rows: [{ cursor_at: null, cursor_id: null, completed_at: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, checkpoint AS payload")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const clients = [chatClient, executionClient];
    const connect = vi.spyOn(pool, "connect").mockImplementation(async () => {
      const client = clients.shift();
      if (!client) throw new Error("unexpected_extra_connection");
      return client;
    });
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [], rowCount: 0 } as never);
    try {
      await expect(scrubHistoricalValidationDetails()).resolves.toBe(false);
    } finally {
      connect.mockRestore();
      query.mockRestore();
    }
    expect(chatCursorUpdates).toContainEqual([
      "scrub_chat_validation_v2",
      null,
      false,
    ]);
  });

  it("retains proof and exit metadata while dropping arbitrary trace data", () => {
    const trace = [
      { kind: "tool_result", tool: "read_file", resultSummary: "private source" },
      {
        kind: "validation",
        repairState: "BLOCKED",
        validation: {
          status: "failed",
          exitCode: 17,
          evidence: { evidenceId: "validation-result:old", artifactRef: "validation-result:old" },
          stderr: "private output",
        },
      },
    ];

    expect(retainHistoricalValidationMetadata(trace)).toEqual([{
      kind: "validation",
      repairState: "BLOCKED",
      validation: {
        status: "failed",
        exitCode: 17,
        evidence: { evidenceId: "validation-result:old", artifactRef: "validation-result:old" },
      },
    }]);
  });

  it("compacts a terminal checkpoint and is stable when repeated", () => {
    const checkpoint = {
      stage: "failed",
      sequence: 42,
      updatedAt: "2026-01-01T00:00:00.000Z",
      evidenceVerdict: "BLOCKED",
      evidenceReason: "Validation failed",
      proofRequired: true,
      detail: "private provider diagnostic",
      recentSteps: [
        { kind: "tool_result", result: "private source" },
        { kind: "validation", status: "failed", exitCode: 2, stdout: "private output" },
      ],
    };
    const compacted = retainHistoricalCheckpoint(checkpoint);
    expect(compacted).toEqual({
      stage: "failed",
      sequence: 42,
      updatedAt: "2026-01-01T00:00:00.000Z",
      evidenceVerdict: "BLOCKED",
      evidenceReason: "Validation failed",
      proofRequired: true,
      recentSteps: [{ kind: "validation", validation: { status: "failed", exitCode: 2 } }],
    });
    expect(retainHistoricalCheckpoint(compacted)).toEqual(compacted);
  });
});
