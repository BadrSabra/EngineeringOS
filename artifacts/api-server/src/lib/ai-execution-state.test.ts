import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => {
  const executionTable = {
    userId: "user_id",
    idempotencyKey: "idempotency_key",
  };
  const now = new Date("2026-01-01T00:00:00.000Z");
  const request = {
    projectId: "project-1",
    sessionId: "session-1",
    message: "run this",
    modelMessage: "run this",
    validationTargetPaths: [],
  };
  const execution = {
    id: "execution-1",
    projectId: request.projectId,
    sessionId: request.sessionId,
    operationId: "execution-1",
    linkedTaskId: null,
    buildPlanMessageId: null,
    userId: "user-1",
    idempotencyKey: "retry-key",
    resumeTokenHash: "hash",
    request: JSON.stringify(request),
    checkpoint: JSON.stringify({ stage: "queued", sequence: 0, updatedAt: now.toISOString() }),
    checkpointVersion: 0,
    status: "queued",
    workerId: null,
    leaseUntil: null,
    lastHeartbeatAt: null,
    cancelRequestedAt: null,
    error: null,
    finalMessageId: null,
    proposalId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };

  let selectCount = 0;
  let insertCount = 0;
  let releaseInitialReads!: () => void;
  const initialReadsReleased = new Promise<void>((resolve) => {
    releaseInitialReads = resolve;
  });

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount += 1;
            if (selectCount <= 2) {
              if (selectCount === 2) releaseInitialReads();
              await initialReadsReleased;
              return [];
            }
            return [execution];
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            insertCount += 1;
            return insertCount === 1 ? [execution] : [];
          },
        }),
      }),
    }),
  };

  return {
    db,
    aiExecutionsTable: executionTable,
  };
});

import { createAiExecution } from "./ai-execution-state.js";

describe("createAiExecution", () => {
  it("converges simultaneous first submissions on one execution", async () => {
    const params = {
      userId: "user-1",
      request: {
        projectId: "project-1",
        sessionId: "session-1",
        message: "run this",
        modelMessage: "run this",
        validationTargetPaths: [],
      },
      idempotencyKey: "retry-key",
      projectId: "project-1",
      sessionId: "session-1",
    };

    const results = await Promise.all([
      createAiExecution(params),
      createAiExecution(params),
    ]);

    expect(results.map(({ execution }) => execution.id)).toEqual([
      "execution-1",
      "execution-1",
    ]);
    expect(results.map(({ created }) => created).sort()).toEqual([false, true]);
  });
});