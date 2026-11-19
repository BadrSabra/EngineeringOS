import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GetAiExecutionResponse } from "@workspace/api-zod";
import {
  aiApplyJournalTable,
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionsTable,
  auditLogsTable,
  db,
  eventsTable,
  projectsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import {
  buildOperationEvidenceProjection,
  redactOperationEvidence,
  type EvidenceInput,
} from "./operation-evidence.js";

const evidenceProjectIds: string[] = [];
const evidenceCorrelationIds: string[] = [];

afterEach(async () => {
  for (const correlationId of evidenceCorrelationIds.splice(0)) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.correlationId, correlationId)).catch(() => undefined);
  }
  for (const projectId of evidenceProjectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }



});

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    execution: {
      id: "execution-1",
      projectId: "project-1",
      operationId: "operation-1",
      correlationId: "operation-1",
      status: "completed",
      attempt: 1,
      checkpoint: JSON.stringify({
        stage: "completed",
        evidenceVerdict: "PROVEN",
        proofRequired: true,
      }),
      checkpointVersion: 2,
      request: JSON.stringify({ workspaceRevision: "revision-1", objective: "Ship the change" }),
      baseRevision: "revision-1",
      error: null,
      createdAt: new Date("2026-08-24T10:00:00Z"),
      startedAt: new Date("2026-08-24T10:00:01Z"),
      completedAt: new Date("2026-08-24T10:00:05Z"),
    },
    events: [{
      id: "event-1",
      type: "ValidationCompleted",
      severity: "success",
      message: "validated",
      timestamp: new Date("2026-08-24T10:00:04Z"),
      payload: { status: "passed", providerMessage: "secret must not escape" },
    }],
    audits: [],
    taskLogs: [],
    journal: [],
    proposal: null,
    ...overrides,
  };
}

describe("operation evidence projection", () => {
  it("correlates bounded receipts and reports a complete history", () => {
    const projection = buildOperationEvidenceProjection(input());
    expect(projection).toMatchObject({
      operationId: "operation-1",
      projectId: "project-1",
      revision: "revision-1",
      completeness: "complete",
      verified: false,
      counts: { checkpoints: 1, events: 1, receipts: 3 },
    });
    expect(projection.receipts.map((receipt) => receipt.kind)).toEqual(["process", "validation", "process"]);
  });

  it("retains an explicit gap and never upgrades incomplete evidence to verified", () => {
    const projection = buildOperationEvidenceProjection(input({
      events: [],
      execution: {
        ...input().execution,
        checkpoint: "{}",
        checkpointVersion: 0,
      },
    }));
    expect(projection.completeness).toBe("retained-with-gaps");
    expect(projection.verified).toBe(false);
    expect(projection.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "checkpoint" }),
      expect.objectContaining({ source: "event" }),
    ]));
  });

  it("preserves cancellation and revision mismatch as non-success states", () => {
    const cancelled = buildOperationEvidenceProjection(input({
      execution: { ...input().execution, status: "cancelled" },
    }));
    expect(cancelled.completeness).toBe("cancelled");

    const mismatched = buildOperationEvidenceProjection(input({
      proposal: {
        revision: 2,
        baseRevision: "revision-2",
        changeSetHash: "change-hash",
        committedHash: null,
      },
    }));
    expect(mismatched.completeness).toBe("uncertain");
    expect(mismatched.hashes.changeSet).toBe("change-hash");
    expect(mismatched.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mismatch" }),
    ]));
  });

  it("does not attribute unbound or older event receipts to the current attempt", () => {
    const projection = buildOperationEvidenceProjection(input({
      execution: { ...input().execution, attempt: 2 },
      events: [
        {
          id: "push-old-attempt",
          type: "GitPushed",
          severity: "success",
          message: "push receipt",
          timestamp: new Date("2026-08-24T10:00:04Z"),
          payload: { status: "passed", operationId: "operation-1", executionAttempt: 1 },
        },
        {
          id: "push-unbound-attempt",
          type: "GitPushed",
          severity: "success",
          message: "legacy push receipt",
          timestamp: new Date("2026-08-24T10:00:04Z"),
          payload: { status: "passed", operationId: "operation-1" },
        },
        {
          id: "push-explicit-attempt",
          type: "GitPushed",
          severity: "success",
          message: "explicit attempt receipt",
          timestamp: new Date("2026-08-24T10:00:04Z"),
          payload: { status: "passed", operationId: "operation-1", attempt: 0 },
        },
      ],
    }));

    expect(projection.receipts.filter((receipt) => receipt.kind === "push").map((receipt) => receipt.attempt))
      .toEqual([1, null, 0]);
  });

  it("returns only fields declared by the generated execution-detail contract", () => {
    const publicProjection = redactOperationEvidence(buildOperationEvidenceProjection(input()));
    const parsed = GetAiExecutionResponse.shape.operationEvidence.parse(publicProjection);
    const normalized = {
      ...parsed,
      receipts: parsed.receipts.map((receipt) => ({
        ...receipt,
        timestamp: receipt.timestamp.toISOString(),
      })),
    };

    expect(publicProjection).not.toHaveProperty("readiness");
    expect(publicProjection).not.toHaveProperty("proofSpine");
    expect(normalized).toEqual(publicProjection);
  });

  it("bounds correlated database reads and retains the newest evidence window", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const executionId = randomUUID();
    const operationId = randomUUID();
    const baseTime = Date.parse("2026-11-19T10:00:00.000Z");
    evidenceProjectIds.push(projectId);
    evidenceCorrelationIds.push(operationId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "operation-evidence-test-user",
      name: `operation-evidence-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/operation-evidence-${projectId}`,
      language: "typescript",
    });
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Operation evidence journal fixture",
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "user",
      content: "Test journal retention across attempts",
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
    });

    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Evidence read fixture",
      status: "completed",
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      linkedTaskId: taskId,
      proposalId,
      operationId,
      correlationId: operationId,
      userId: "operation-evidence-test-user",
      idempotencyKey: `operation-evidence-${executionId}`,
      resumeTokenHash: "test-resume-token-hash",
      request: JSON.stringify({ workspaceRevision: "revision-1" }),
      checkpoint: JSON.stringify({ stage: "completed" }),
      checkpointVersion: 1,
      status: "completed",
      attempt: 1,
      baseRevision: "revision-1",
      createdAt: new Date(baseTime - 1_000),
      startedAt: new Date(baseTime),
      completedAt: new Date(baseTime + 400_000),
    });

    await db.insert(eventsTable).values(Array.from({ length: 130 }, (_, index) => ({
      id: `operation-evidence-event-${executionId}-${index}`,
      type: "ValidationCompleted",
      projectId,
      correlationId: operationId,
      severity: "info" as const,
      message: `validation event ${index}`,
      payload: { status: `event-${index}` },
      timestamp: new Date(baseTime + index * 1_000),
    })));
    await db.insert(auditLogsTable).values(Array.from({ length: 90 }, (_, index) => ({
      id: `operation-evidence-audit-${executionId}-${index}`,
      entityType: "task" as const,
      entityId: taskId,
      action: "updated" as const,
      projectId,
      correlationId: operationId,
      actor: "test",
      reason: `audit ${index}`,
      timestamp: new Date(baseTime + index * 1_000),
    })));
    await db.insert(taskLogsTable).values(Array.from({ length: 90 }, (_, index) => ({
      id: `operation-evidence-task-log-${executionId}-${index}`,
      taskId,
      correlationId: operationId,
      level: "info" as const,
      message: `task log ${index}`,
      timestamp: new Date(baseTime + index * 1_000),
    })));

    await db.insert(aiApplyJournalTable).values([
      ...Array.from({ length: 81 }, (_, index) => ({
        id: `operation-evidence-journal-old-${executionId}-${index}`,
        operationId,
        attemptId: `old-attempt-${executionId}`,
        projectId,
        proposalId,
        stage: "OldAttemptJournalStage",
        sequence: index + 1,
        payload: { attempt: 1, reason: `old-attempt-${index + 1}` },
        // Keep previous-attempt journal entries older than the current event window.
        createdAt: new Date(baseTime - 100_000 + index * 500),
      })),
      {
        id: `operation-evidence-journal-new-${executionId}`,
        operationId,
        attemptId: `new-attempt-${executionId}`,
        projectId,
        proposalId,
        stage: "NewAttemptJournalStage",
        sequence: 1,
        payload: { attempt: 2, reason: "new-attempt-latest" },
        createdAt: new Date(baseTime + 300_000),
      },
    ]);

    const [execution] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, executionId));
    expect(execution).toBeDefined();
    const projection = await loadOperationEvidence(execution!);

    expect(projection.counts).toMatchObject({
      events: 120,
      audit: 80,
      taskLogs: 80,
      journal: 80,
    });
    expect(projection.receipts[0]).toMatchObject({
      kind: "process",
      status: "started",
    });
    expect(projection.receipts.some((receipt) => receipt.detail === "event-129")).toBe(true);
    expect(projection.receipts.some((receipt) => receipt.detail === "event-0")).toBe(false);
    expect(projection.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: "NewAttemptJournalStage",
        attempt: 2,
        diagnostic: "new-attempt-latest",
      }),
    ]));
    expect(projection.receipts.some((receipt) => receipt.diagnostic === "old-attempt-1")).toBe(false);
    expect(projection.receipts.at(-1)).toMatchObject({
      kind: "process",
      status: "passed",
    });
  });

  it("bounds and redacts provider-derived diagnostics", () => {
    const projection = buildOperationEvidenceProjection(input({
      events: Array.from({ length: 150 }, (_, index) => ({
        id: `event-${index}`,
        type: "ProviderFailed",
        severity: "error",
        message: `provider secret sk-live-${index}`,
        timestamp: new Date("2026-08-24T10:00:04Z"),
        payload: { status: "failed" },
      })),
    }));
    expect(projection.counts.events).toBe(120);
    expect(JSON.stringify(projection)).not.toContain("sk-live-");
  });
});