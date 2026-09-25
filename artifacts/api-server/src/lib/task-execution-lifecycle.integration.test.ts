import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MISSION_REPAIR_TOOL_CAPABILITY_ID } from "./agent-state/mission-repair-effect.js";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiExecutionAcceptancesTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";

const runAgentWithFallback = vi.hoisted(() => vi.fn(async () => ({
  result: {
    summary: "Fixture execution completed.",
    confidence: "high",
    needsHumanReview: false,
    steps: ["Server-owned fixture output accepted."],
  },
  effectiveProvider: "groq" as const,
})));
const chatWithFallback = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({
  result: {
    response: "Mission tool-loop fixture completed.",
    pendingChanges: [] as Array<{ path: string; newContent: string }>,
    sources: [],
  },
  effectiveProvider: "groq" as const,
})));
const runRepairValidation = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({
  status: "passed" as const,
  evidence: { artifactRef: "fixture-validation-receipt" },
})));

vi.mock("./ai-route-helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-route-helpers.js")>("./ai-route-helpers.js");
  return {
    ...actual,
    runAgentWithFallback,
    chatWithFallback,
  };
});

vi.mock("@workspace/ai-orchestrator", async () => {
  const actual = await vi.importActual<typeof import("@workspace/ai-orchestrator")>("@workspace/ai-orchestrator");
  return {
    ...actual,
    buildProjectContext: vi.fn(async () => ({ fixture: true })),
    invalidateContextCache: vi.fn(),
  };
});

vi.mock("./task-progress.js", () => ({
  createTaskProgressEmitter: vi.fn(() => ({
    start: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    terminal: vi.fn(async () => undefined),
  })),
}));

vi.mock("./ai-repair-validation.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-repair-validation.js")>("./ai-repair-validation.js");
  return {
    ...actual,
    runRepairValidation,
  };
});

import { executeTaskLifecycle } from "./task-execution-service.js";

async function waitForEpisode(executionId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [episode] = await db
      .select({
        missionId: aiAgentEpisodesTable.missionId,
        goalId: aiAgentEpisodesTable.goalId,
        planRevision: aiAgentEpisodesTable.planRevision,
        scope: aiAgentEpisodesTable.scope,
      })
      .from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.executionId, executionId))
      .limit(1);
    if (episode) return episode;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Episode was not materialized for execution ${executionId}`);
}

async function cleanupProjectExecutionData(projectId: string) {
  await db.delete(aiAgentEpisodeEventsTable).where(eq(aiAgentEpisodeEventsTable.projectId, projectId));
  await db.delete(aiAgentObservationsTable).where(eq(aiAgentObservationsTable.projectId, projectId));
  await db.delete(aiAgentEffectsTable).where(eq(aiAgentEffectsTable.projectId, projectId));
  await db.delete(aiExecutionAcceptancesTable).where(
    eq(aiExecutionAcceptancesTable.projectId, projectId),
  );
  await db.delete(aiAgentEffectBundlesTable).where(eq(aiAgentEffectBundlesTable.projectId, projectId));
  await db.delete(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.projectId, projectId));
  await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
}

async function createMissionToolLoopFixture(input: {
  phase: "execute" | "validate";
  approvalRequired: boolean;
}) {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const taskId = randomUUID();
  const now = new Date();
  const workspaceRoot = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";
  const rootPath = await mkdtemp(join(workspaceRoot, "mission-tool-loop-"));
  await mkdir(join(rootPath, "src"), { recursive: true });
  await writeFile(join(rootPath, "src", "target.ts"), "export const value = 'base';\n", "utf8");

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "mission-effect-test-user",
    name: `mission-effect-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "mission-effect-test-user",
    title: "Mission repair effect fixture",
    intent: "Verify a bounded Mission task.",
    status: "active",
    scope: { kind: "project", projectId },
    autonomyPolicy: {},
    budget: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Verify the candidate",
    description: "Run the server-owned Mission tool loop.",
    status: "running",
    priority: "p1",
    successCriteria: { objective: "Verify the target source file." },
    evidenceContract: {},
    outcomeContract: {
      planRevision: {
        hash: `mission-plan-${goalId}`,
        steps: [{
          kind: input.phase,
          files: ["src/target.ts"],
          validationProfile: "workspace-typecheck",
          approvalRequired: input.approvalRequired,
        }],
      },
    },
    nextAction: { kind: "task", taskId },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId,
    goalId,
    phase: input.phase,
    title: `Mission ${input.phase} fixture`,
    prompt: "Use only the server-authorized project scope.",
    relatedFiles: ["src/target.ts"],
    status: "verifying",
    retryCount: 0,
    maxRetries: 2,
    createdAt: now,
    updatedAt: now,
  });

  return {
    projectId,
    missionId,
    goalId,
    taskId,
    rootPath,
    now,
    cleanup: async () => {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

describe("real durable task execution lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists execution, checkpoint, task completion, and terminal acceptance", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "lifecycle-test-user",
      name: `lifecycle-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Durable lifecycle fixture",
      prompt: "Complete the deterministic fixture task",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "lifecycle-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("completed");
      expect(outcome.executionId).toEqual(expect.any(String));
      expect(runAgentWithFallback).toHaveBeenCalledTimes(1);
      await waitForEpisode(outcome.executionId!);

      const [task] = await db
        .select({ status: tasksTable.status, workerId: tasksTable.workerId })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(task).toEqual({ status: "completed", workerId: null });

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          finalMessageId: aiExecutionsTable.finalMessageId,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, outcome.executionId!));
      expect(execution).toMatchObject({
        status: "completed",
        workerId: null,
      });

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
          resumable: aiExecutionAcceptancesTable.resumable,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, outcome.executionId!));
      expect(acceptance).toEqual({
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
        nextActionCode: "NONE",
        resumable: 0,
      });
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("binds workflow task episodes to the workflow scope", async () => {
    const projectId = randomUUID();
    const workflowId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "workflow-episode-test-user",
      name: `workflow-episode-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/workflow-episode-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowsTable).values({
      id: workflowId,
      projectId,
      name: "Episode identity workflow",
      description: "Fixture for workflow-scoped episode identity.",
      status: "idle",
      phases: [],
      executionCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      workflowId,
      title: "Workflow episode task",
      prompt: "Complete the deterministic workflow fixture task",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "workflow-episode-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      const episode = await waitForEpisode(outcome.executionId!);
      expect(episode).toMatchObject({
        missionId: null,
        goalId: null,
        planRevision: null,
        scope: {
          kind: "workflow-task",
          taskId,
          workflowId,
        },
      });
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("requires a directly observed candidate effect for an approved Mission repair", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: false,
    });
    const candidateContent = "export const value = 'candidate';\n";
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-call-mission-repair-1",
        toolName: "write_file" as const,
        path: "src/target.ts",
        inputHash: "a".repeat(64),
      };
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      // A replay of the same provider call must be idempotent in the Episode ledger.
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      return {
        result: {
          response: "Prepared and verified the bounded repair.",
          pendingChanges: [{ path: "src/target.ts", newContent: candidateContent }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation.mockResolvedValue({
      status: "passed",
      evidence: { artifactRef: "mission-repair-validator-pass" },
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("completed");
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");
      expect(runRepairValidation).toHaveBeenCalledTimes(1);
      expect(runRepairValidation.mock.calls[0]?.[4]).toEqual([
        { path: "src/target.ts", newContent: candidateContent },
      ]);

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.projectId, fixture.projectId))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "SUCCEEDED",
        effectBundleId: expect.any(String),
      });

      const [bundle] = await db
        .select({ verdict: aiAgentEffectBundlesTable.verdict })
        .from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.executionId, outcome.executionId!))
        .limit(1);
      expect(bundle?.verdict).toBe("OBSERVED");
      const effects = await db
        .select({ status: aiAgentEffectsTable.status })
        .from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.executionId, outcome.executionId!));
      expect(effects).toEqual([{ status: "observed" }]);

      const observations = await db
        .select({
          provenance: aiAgentObservationsTable.provenance,
          predicate: aiAgentObservationsTable.predicate,
          value: aiAgentObservationsTable.value,
        })
        .from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.executionId, outcome.executionId!));
      expect(observations).toHaveLength(2);
      expect(observations.every((observation) =>
        observation.provenance === "DIRECT_OBSERVATION"
        && observation.predicate === "workspace.tree_hash"
      )).toBe(true);
      expect(observations[0]?.value).not.toEqual(observations[1]?.value);

      const episodeEvents = await db
        .select({
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, outcome.executionId!));
      const eventTypes = episodeEvents.map((event) => event.eventType);
      expect(eventTypes).toContain("ACTION_REQUESTED");
      expect(eventTypes).toContain("ACTION_COMMITTED");
      expect(eventTypes).toContain("EFFECT_CLASSIFIED");
      const toolRequests = episodeEvents.filter((event) => {
        const action = (event.payload as { action?: { capabilityId?: string } } | null)?.action;
        return event.eventType === "ACTION_REQUESTED"
          && action?.capabilityId === MISSION_REPAIR_TOOL_CAPABILITY_ID;
      });
      const toolCommits = episodeEvents.filter((event) =>
        event.eventType === "ACTION_COMMITTED"
        && String(
          (event.payload as { actionId?: unknown } | null)?.actionId ?? "",
        ).startsWith("mission-repair-tool:")
      );
      expect(toolRequests).toHaveLength(1);
      expect(toolCommits).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps Mission validation read-only and outside the effect gate", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "validate",
      approvalRequired: false,
    });
    await db.update(tasksTable)
      .set({ updatedAt: new Date(fixture.now.getTime() - 60_000) })
      .where(eq(tasksTable.id, fixture.taskId));
    const liveContent = "export const value = 'base';\n";
    chatWithFallback.mockResolvedValue({
      result: {
        response: "Validated the current workspace.",
        // A provider-shaped patch must not turn a validation task into a repair.
        pendingChanges: [{ path: "src/target.ts", newContent: "export const value = 'injected';\n" }],
        sources: [],
      },
      effectiveProvider: "groq",
    });
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onReadOnlyInvocation?: import("@workspace/ai-orchestrator").ReadOnlyToolInvocationCallback;
        allowedToolNames?: readonly string[];
        authorizedToolManifestNames?: readonly string[];
        missionReadPathScope?: readonly string[];
      };
      expect(baseParams.allowedToolNames).toEqual(
        expect.arrayContaining([
          "read_file",
          "read_file_range",
          "project.list_tree",
          "git_status",
          "git_diff",
          "git_log",
          "run_validation",
        ]),
      );
      expect(baseParams.allowedToolNames).not.toEqual(
        expect.arrayContaining(["list_directory", "search_code"]),
      );
      expect(baseParams.authorizedToolManifestNames).toEqual(baseParams.allowedToolNames);
      expect(baseParams.missionReadPathScope).toEqual(["src/target.ts"]);
      const invocation = {
        toolCallId: "provider-read-mission-1",
        toolName: "git_diff" as const,
        inputHash: "c".repeat(64),
        manifestHash: "d".repeat(64),
      };
      await baseParams.onReadOnlyInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onReadOnlyInvocation?.({
        ...invocation,
        phase: "recorded",
        status: "completed",
        outputHash: "e".repeat(64),
      });
      const treeInvocation = {
        toolCallId: "provider-tree-mission-1",
        toolName: "project.list_tree" as const,
        inputHash: "f".repeat(64),
        manifestHash: "d".repeat(64),
      };
      await baseParams.onReadOnlyInvocation?.({ ...treeInvocation, phase: "requested" });
      await baseParams.onReadOnlyInvocation?.({
        ...treeInvocation,
        phase: "recorded",
        status: "completed",
        outputHash: "a".repeat(64),
      });
      return {
        result: {
          response: "Validated the current workspace.",
          pendingChanges: [{ path: "src/target.ts", newContent: "export const value = 'injected';\n" }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation.mockResolvedValue({
      status: "passed",
      evidence: { artifactRef: "mission-validate-only-receipt" },
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("completed");
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8")).toBe(liveContent);
      expect(runRepairValidation).toHaveBeenCalledTimes(1);
      expect(runRepairValidation.mock.calls[0]?.[4]).toEqual([]);
      expect(await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.projectId, fixture.projectId))).toEqual([]);
      expect(await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.projectId, fixture.projectId))).toEqual([]);
      const events = await db
        .select({
          episodeId: aiAgentEpisodeEventsTable.episodeId,
          executionId: aiAgentEpisodeEventsTable.executionId,
          attempt: aiAgentEpisodeEventsTable.attempt,
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.projectId, fixture.projectId));
      expect(events
        .filter((event) => /^(ACTION|EFFECT|PROOF|ACCEPTANCE)/.test(event.eventType)))
        .toHaveLength(0);
      expect(events.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["OBSERVATION_REQUESTED", "OBSERVATION_RECORDED"]),
      );
      const observationRequest = events.find((event) => event.eventType === "OBSERVATION_REQUESTED");
      expect(observationRequest?.payload).toMatchObject({
        observationId: expect.any(String),
        toolCallId: "provider-read-mission-1",
        toolName: "git_diff",
        inputHash: "c".repeat(64),
        manifestHash: "d".repeat(64),
        projectRevision: fixture.now.toISOString(),
        authorization: "server_owned",
      });
      const observationRecorded = events.find((event) => event.eventType === "OBSERVATION_RECORDED");
      expect(observationRecorded?.payload).toMatchObject({
        observationId: (observationRequest?.payload as { observationId: string }).observationId,
        status: "completed",
        outputHash: "e".repeat(64),
        projectRevision: fixture.now.toISOString(),
      });
      expect(observationRequest?.episodeId).toEqual(expect.any(String));
      expect(observationRecorded?.episodeId).toBe(observationRequest?.episodeId);
      expect(observationRequest?.executionId).toEqual(expect.any(String));
      expect(observationRecorded?.executionId).toBe(observationRequest?.executionId);
      expect(observationRequest?.attempt).toEqual(expect.any(Number));
      expect(observationRecorded?.attempt).toBe(observationRequest?.attempt);
      expect(JSON.stringify(observationRequest?.payload)).not.toContain("src/target.ts");
      expect(JSON.stringify(observationRecorded?.payload)).not.toContain("Validated the current workspace.");
      const treeRequest = events.find((event) =>
        event.eventType === "OBSERVATION_REQUESTED"
        && (event.payload as { toolName?: string }).toolName === "project.list_tree",
      );
      const treeRecorded = events.find((event) =>
        event.eventType === "OBSERVATION_RECORDED"
        && (event.payload as { toolName?: string }).toolName === "project.list_tree",
      );
      expect(treeRequest?.payload).toMatchObject({
        toolCallId: "provider-tree-mission-1",
        projectRevision: fixture.now.toISOString(),
        authorization: "server_owned",
      });
      expect(treeRecorded?.payload).toMatchObject({
        observationId: (treeRequest?.payload as { observationId: string }).observationId,
        status: "completed",
        outputHash: "a".repeat(64),
        projectRevision: fixture.now.toISOString(),
      });
      const baseParams = chatWithFallback.mock.calls.at(-1)?.[1] as {
        onMutationInvocation?: unknown;
      } | undefined;
      expect(baseParams?.onMutationInvocation).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a failed Mission observation when the project revision changes mid-read", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "validate",
      approvalRequired: false,
    });
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onReadOnlyInvocation?: import("@workspace/ai-orchestrator").ReadOnlyToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-tree-revision-drift",
        toolName: "project.list_tree" as const,
        inputHash: "1".repeat(64),
        manifestHash: "2".repeat(64),
      };
      await baseParams.onReadOnlyInvocation?.({ ...invocation, phase: "requested" });
      await db.update(projectsTable)
        .set({ updatedAt: new Date(fixture.now.getTime() + 1_000) })
        .where(eq(projectsTable.id, fixture.projectId));
      await expect(
        baseParams.onReadOnlyInvocation?.({
          ...invocation,
          phase: "recorded",
          status: "completed",
          outputHash: "3".repeat(64),
        }),
      ).rejects.toThrow("mission_project_revision_changed_after_read");
      return {
        result: {
          response: "The project changed during the read; no tree result was delivered.",
          pendingChanges: [],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });

    try {
      await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-revision-drift-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
      });
      const events = await db
        .select({
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.projectId, fixture.projectId));
      const request = events.find((event) =>
        event.eventType === "OBSERVATION_REQUESTED"
        && (event.payload as { toolCallId?: string }).toolCallId === "provider-tree-revision-drift",
      );
      const recorded = events.find((event) =>
        event.eventType === "OBSERVATION_RECORDED"
        && (event.payload as { toolCallId?: string }).toolCallId === "provider-tree-revision-drift",
      );

      expect(request?.payload).toMatchObject({
        projectRevision: fixture.now.toISOString(),
        authorization: "server_owned",
      });
      expect(recorded?.payload).toMatchObject({
        status: "failed",
        diagnosticCode: "PROJECT_REVISION_CHANGED",
        projectRevision: fixture.now.toISOString(),
      });
      expect(recorded?.payload).not.toHaveProperty("outputHash");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a Mission repair candidate when plan approval is still pending", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: true,
    });
    chatWithFallback.mockResolvedValue({
      result: {
        response: "A candidate was returned.",
        pendingChanges: [{ path: "src/target.ts", newContent: "export const value = 'unapproved';\n" }],
        sources: [],
      },
      effectiveProvider: "groq",
    });
    runRepairValidation.mockResolvedValue({
      status: "passed",
      evidence: { artifactRef: "must-not-run" },
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });
      await waitForEpisode(outcome.executionId!);

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("verifying");
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");
      expect(runRepairValidation).not.toHaveBeenCalled();
      expect(await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.projectId, fixture.projectId))).toEqual([]);
      expect(await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.projectId, fixture.projectId))).toEqual([]);
      const events = await db
        .select({ eventType: aiAgentEpisodeEventsTable.eventType })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.projectId, fixture.projectId));
      expect(events.map((event) => event.eventType)).not.toContain("ACTION_REQUESTED");
      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.projectId, fixture.projectId))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "FAILED",
        effectBundleId: null,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not complete a delivery Goal or Mission without a server-owned receipt", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "delivery-gate-test-user",
      name: `delivery-gate-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/delivery-gate-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "delivery-gate-test-user",
      title: "Delivery gate fixture",
      intent: "Deliver the verified result",
      status: "active",
      scope: { kind: "project", projectId },
      autonomyPolicy: {},
      budget: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Deliver the verified result",
      description: "A delivery goal requiring a server-owned receipt.",
      status: "running",
      priority: "p1",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {
        deliveryRequired: true,
        planRevision: { hash: "mission-plan-episode-1" },
      },
      nextAction: { kind: "task", taskId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      goalId,
      title: "Delivery gate task",
      prompt: "Complete the deterministic delivery fixture task",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "delivery-gate-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      const episode = await waitForEpisode(outcome.executionId!);
      expect(episode).toMatchObject({
        missionId,
        goalId,
        planRevision: "mission-plan-episode-1",
        scope: {
          kind: "mission-task",
          taskId,
          missionId,
          goalId,
        },
      });
      const [goal] = await db
        .select({ status: aiGoalsTable.status, outcomeContract: aiGoalsTable.outcomeContract })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      const [mission] = await db
        .select({ status: aiMissionsTable.status })
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionId));
      expect(goal).toMatchObject({
        status: "verifying",
        outcomeContract: {
          deliveryRequired: true,
          acceptance: {
            verdict: "INCOMPLETE",
          },
        },
      });
      const acceptance = (goal?.outcomeContract as Record<string, unknown>).acceptance as Record<string, unknown>;
      expect(acceptance.deliveryReceipt).toBeUndefined();
      expect(mission?.status).toBe("waiting");
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});