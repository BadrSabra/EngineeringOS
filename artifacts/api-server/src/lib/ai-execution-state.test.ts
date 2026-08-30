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

import {
  createAiExecution,
  createAutonomousOperationContract,
  createRecipeOperationBinding,
  checkRecipeOperationBinding,
  parseAiExecutionCheckpoint,
  transitionAutonomousOperation,
  validateAutonomousOperationCompletion,
} from "./ai-execution-state.js";

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

describe("autonomous operation contract", () => {
  it("enforces the server-owned stage graph and evidence gate", () => {
    const planned = createAutonomousOperationContract({
      operationId: "operation-1",
      objective: "Fix the parser",
      revisionManifest: "revision-1",
    });
    expect(() => transitionAutonomousOperation(planned, "delivering")).toThrow(/Illegal/);
    const validating = transitionAutonomousOperation(
      transitionAutonomousOperation(planned, "inspecting"),
      "mutating",
    );
    expect(() => transitionAutonomousOperation(validating, "succeeded")).toThrow(/Illegal/);
    const ready = transitionAutonomousOperation(
      transitionAutonomousOperation(validating, "validating"),
      "promoting",
    );
    expect(() => transitionAutonomousOperation(ready, "delivering")).not.toThrow();
  });

  it("retains and validates the operation contract inside a checkpoint", () => {
    const operation = createAutonomousOperationContract({
      operationId: "operation-2",
      objective: "Repair a failing test",
    });
    const checkpoint = parseAiExecutionCheckpoint(JSON.stringify({
      stage: "running",
      sequence: 1,
      operation,
      updatedAt: new Date().toISOString(),
    }));
    expect(checkpoint?.operation?.operationId).toBe("operation-2");
    expect(parseAiExecutionCheckpoint(JSON.stringify({
      stage: "running",
      sequence: 2,
      operation: { ...operation, retryBudget: 1, repairAttempts: 2 },
      updatedAt: new Date().toISOString(),
    }))).toBeUndefined();
  });

  it("fails closed for stale identity, scope, phase, and lease ownership", () => {
    const binding = createRecipeOperationBinding({
      projectId: "project-1",
      operationId: "recipe-operation-1",
      sourceRevision: "revision-1",
      candidateIdentity: "candidate-1",
      candidateWorkspace: "/tmp/candidate-1",
      approvedPaths: ["src/parser.ts"],
      phase: "running",
      leaseOwner: "worker-1",
      leaseUntil: "2026-01-01T00:05:00.000Z",
    });
    expect(checkRecipeOperationBinding(binding, { projectId: "project-2" }).reason).toBe("project_mismatch");
    expect(checkRecipeOperationBinding(binding, { sourceRevision: "revision-2" }).reason).toBe("revision_mismatch");
    expect(checkRecipeOperationBinding(binding, { approvedPaths: ["src/other.ts"] }).reason).toBe("scope_mismatch");
    expect(checkRecipeOperationBinding(binding, { phase: "queued" }).reason).toBe("phase_mismatch");
    expect(checkRecipeOperationBinding(binding, { leaseOwner: "worker-2" }).reason).toBe("lease_owner_mismatch");
    expect(checkRecipeOperationBinding(binding, {
      leaseOwner: "worker-1",
      requireLease: true,
      now: new Date("2026-01-01T00:06:00.000Z"),
    }).reason).toBe("lease_expired");
  });

  it("blocks completion when acceptance evidence is missing or bound to stale bytes", () => {
    const operation = createAutonomousOperationContract({
      operationId: "operation-3",
      objective: "Update the parser",
      revisionManifest: "revision-current",
      targetPaths: ["src/parser.ts"],
      expectedBehavior: "The parser accepts quoted values.",
    });

    expect(validateAutonomousOperationCompletion(operation, {
      evidenceVerdict: "PARTIAL",
      workspaceRevision: "revision-current",
      evidenceRefs: [],
    })).toMatchObject({ allowed: false });

    expect(validateAutonomousOperationCompletion(operation, {
      evidenceVerdict: "PROVEN",
      workspaceRevision: "revision-stale",
      evidenceRefs: ["validation-result:1"],
    })).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining(["workspace revision does not match the execution request"]),
    });

    expect(validateAutonomousOperationCompletion(operation, {
      evidenceVerdict: "PROVEN",
      workspaceRevision: "revision-current",
      candidateIdentity: "candidate-stale",
      evidenceRefs: ["validation-result:1"],
    })).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining(["candidate identity does not match the operation"]),
    });
  });

  it("accepts a complete operation only with proven evidence and matching revision", () => {
    const operation = createAutonomousOperationContract({
      operationId: "operation-4",
      objective: "Update the parser",
      revisionManifest: "revision-current",
      targetPaths: ["src/parser.ts"],
      expectedBehavior: "The parser accepts quoted values.",
    });
    expect(validateAutonomousOperationCompletion(operation, {
      evidenceVerdict: "PROVEN",
      workspaceRevision: "revision-current",
      evidenceRefs: ["validation-result:1"],
    })).toEqual({ allowed: true, reasons: [] });
  });
});