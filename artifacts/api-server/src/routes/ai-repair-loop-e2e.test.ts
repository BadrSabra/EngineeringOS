/**
 * End-to-end repair-loop coverage.
 *
 * Unlike the broad SSE integration fixture, this test keeps the real
 * chatWithFallback -> chat -> tool-execution-engine path. Only the provider
 * strategy is deterministic, so the test never needs a live model or key.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiChangeProposalsTable,
  db,
  projectsTable,
} from "@workspace/db";
import type { RawGroqResponse } from "@workspace/ai-orchestrator";
import type { RepairVerificationResult } from "../lib/ai-repair-validation.js";

const harness = vi.hoisted(() => {
  const responses: RawGroqResponse[] = [];
  const validationResults: RepairVerificationResult[] = [];
  const calls: Array<{ toolNames: string[]; toolChoice?: string; messages: unknown[] }> = [];

  const toolResponse = (id: string, name: string, args: Record<string, unknown>): RawGroqResponse => ({
    content: null,
    toolCalls: [{
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    }],
    model: "repair-loop-fixture-model",
    usage: { promptTokens: 0, completionTokens: 0 },
  });

  const finalResponse = (content: string): RawGroqResponse => ({
    content,
    toolCalls: null,
    model: "repair-loop-fixture-model",
    usage: { promptTokens: 0, completionTokens: 0 },
  });

  const strategy = {
    providerId: "groq",
    supportsNativeStream: false,
    ownsModelFallback: false,
    call: vi.fn(async (messages: unknown[], options: { tools?: Array<{ function?: { name?: string } }>; toolChoice?: string }) => {
      calls.push({
        toolNames: (options.tools ?? [])
          .map((tool) => tool.function?.name)
          .filter((name): name is string => Boolean(name)),
        toolChoice: options.toolChoice,
        messages,
      });
      const response = responses.shift() ?? finalResponse("The approved repair is ready for review.");
      return response;
    }),
    stream: vi.fn(async function* () {
      yield "The approved repair is ready for review.";
    }),
  };

  return { responses, validationResults, calls, strategy, toolResponse, finalResponse };
});

vi.mock("../../../../lib/ai-orchestrator/src/provider-registry.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getStrategy: vi.fn(() => harness.strategy) };
});

vi.mock("../../../../lib/ai-orchestrator/src/strategies/groq.strategy.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, groqStrategy: harness.strategy };
});

vi.mock("../../../../lib/ai-orchestrator/src/strategies/openrouter.strategy.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, openrouterStrategy: harness.strategy };
});

vi.mock("../../../../lib/ai-orchestrator/src/agents/query-planner.js", () => ({
  planQuery: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../../lib/ai-orchestrator/src/model-selection/decision-engine.js", () => ({
  resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
}));

vi.mock("../../../../lib/ai-orchestrator/src/model-selection/provider-strategy.js", () => ({
  resolveExecutionProvider: vi.fn((_: unknown, provider: string) => ({ providerId: provider })),
}));

vi.mock("../../../../lib/ai-orchestrator/src/model-selection/model-resolver.js", () => ({
  resolveExecutionModel: vi.fn(() => ({
    model: "repair-loop-fixture-model",
    powerModel: "repair-loop-fixture-model",
    fallbackChain: ["repair-loop-fixture-model"],
  })),
}));

vi.mock("../../../../lib/ai-orchestrator/src/openrouter/model-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resolveFallbackChain: vi.fn(() => [{ id: "repair-loop-fixture-model" }]),
    buildFallbackChainFromId: vi.fn(() => [{ id: "repair-loop-fixture-model" }]),
  };
});

vi.mock("@workspace/ai-orchestrator", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildProjectContext: vi.fn(async () => ({
      project: "repair-loop integration fixture",
      recentTasks: "No tasks yet",
      latestMetrics: "No metrics yet",
      graphSummary: "No dependency graph yet",
      recentEvents: "No recent events",
      workflows: "No workflows defined yet",
      metricsVerified: false,
    })),
    enrichContextWithMemories: vi.fn(async () => undefined),
    writeSessionMemories: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/ai-route-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireProvider: vi.fn(async () => ({
      provider: "groq",
      apiKey: "repair-loop-fixture-key",
    })),
  };
});

vi.mock("../lib/ai-repair-validation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ai-repair-validation.js")>();
  return {
    ...actual,
    runRepairValidation: vi.fn(async (...args: unknown[]) => {
      const fixtureResult = harness.validationResults.shift();
      return fixtureResult ?? actual.runRepairValidation(
        ...(args as Parameters<typeof actual.runRepairValidation>),
      );
    }),
  };
});

type SseEvent = Record<string, unknown>;

function parseSseEvents(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => {
      try {
        return JSON.parse(chunk.slice(6)) as SseEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is SseEvent => event !== null);
}

async function insertProject(rootPath: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `repair-loop-${id.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertApprovedPlan(projectId: string, targetPath: string): Promise<{ sessionId: string; messageId: string }> {
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const now = new Date();
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Approved repair loop fixture",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Approved repair plan",
    repairPlanMetadata: JSON.stringify([{
      findingId: "F-01",
      files: [targetPath],
      steps: ["Prepare the approved bounded repair and validate it."],
      validationProfile: "workspace-typecheck",
      verdictScope: "PRODUCTION",
      scopedFindingStatus: "PRODUCTION_PROVEN",
    }]),
    taskResult: JSON.stringify({
      kind: "IMPLEMENTATION_PLAN_RESULT",
      objective: "Make the approved dashboard repair reviewable",
      summary: "Prepare one bounded pending change and validate it before review.",
      assumptions: [],
      steps: [{
        id: "step-1",
        title: "Prepare the approved dashboard file",
        description: "Read the file, propose a reviewable change, and validate it.",
        action: "modify",
        files: [targetPath],
        dependsOn: [],
        validation: ["Run workspace typecheck"],
      }],
      validationCommands: ["pnpm run typecheck"],
      risks: [],
      approvalStatus: "APPROVED",
      writeAccess: "APPROVED_FOR_BUILD",
    }),
    createdAt: now,
  });
  return { sessionId, messageId };
}

describe("verified repair loop through the real SSE route and chat engine", () => {
  const projectIds: string[] = [];
  const rootAliases: string[] = [];

  afterEach(async () => {
    harness.responses.length = 0;
    harness.validationResults.length = 0;
    harness.calls.length = 0;
    harness.strategy.call.mockClear();
    for (const projectId of projectIds.splice(0)) {
      const sessions = await db
        .select({ id: aiChatSessionsTable.id })
        .from(aiChatSessionsTable)
        .where(eq(aiChatSessionsTable.projectId, projectId));
      for (const session of sessions) {
        await db
          .delete(aiChatMessagesTable)
          .where(eq(aiChatMessagesTable.sessionId, session.id))
          .catch(() => undefined);
      }
      await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
    }
    for (const alias of rootAliases.splice(0)) {
      await fs.rm(alias, { recursive: true, force: true });
    }
  });

  it("keeps the source untouched while read -> pending write -> overlay validation reaches READY_FOR_REVIEW", async () => {
    const workspaceRoot = path.resolve(process.cwd(), "../..");
    const rootPath = await fs.mkdtemp("/tmp/repair-loop-root-");
    await fs.rm(rootPath, { recursive: true, force: true });
    await fs.symlink(workspaceRoot, rootPath, "dir");
    rootAliases.push(rootPath);
    const targetPath = "artifacts/dashboard/src/App.tsx";
    const absoluteTargetPath = path.join(workspaceRoot, targetPath);
    const originalContent = await fs.readFile(absoluteTargetPath, "utf8");
    const pendingContent = `${originalContent}\n// deterministic verified-repair-loop fixture\n`;
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, targetPath);

    harness.responses.push(
      harness.toolResponse("read-1", "read_file", { path: targetPath }),
      harness.toolResponse("write-1", "write_file", {
        path: targetPath,
        content: pendingContent,
        reason: "Prepare the approved bounded repair for review.",
      }),
      harness.toolResponse("validate-1", "run_validation", { profile: "workspace-typecheck" }),
      harness.finalResponse(JSON.stringify({
        response: "The approved repair passed validation and is ready for review.",
        sources: [],
      })),
    );

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: [
          "نفذ الإصلاحات",
          "Implementation task: validate the approved change.",
          "Done looks like: the pending change passes server-owned validation.",
          `Relevant files: ${targetPath}`,
        ].join("\n"),
      });

    expect(response.status).toBe(200);
    const events = parseSseEvents(response.text);
    const repairStates = events
      .filter((event) => event.type === "repair_state")
      .map((event) => event.state);
    const validationEvents = events.filter((event) => event.type === "validation");
    const doneEvent = events.find((event) => event.type === "done");

    expect(repairStates).toEqual(["VALIDATING", "READY_FOR_REVIEW"]);
    expect(validationEvents).toHaveLength(1);
    expect(validationEvents[0]).toMatchObject({
      status: "passed",
      repairState: "READY_FOR_REVIEW",
      profile: "workspace-typecheck",
      attempt: 1,
    });
    expect(doneEvent).not.toHaveProperty("error");
    expect(doneEvent).toMatchObject({
      pendingChanges: [{
        path: targetPath,
        absolutePath: absoluteTargetPath,
        newContent: pendingContent,
        originalContent,
        validationProfile: "workspace-typecheck",
      }],
    });

    expect(await fs.readFile(absoluteTargetPath, "utf8")).toBe(originalContent);
    expect(harness.strategy.call).toHaveBeenCalledTimes(4);
    expect(harness.calls.some((call) => call.toolNames.includes("run_validation"))).toBe(true);
    const scopedInstructions = harness.calls
      .flatMap((call) => call.messages)
      .map((message) => (
        typeof message === "object" &&
        message !== null &&
        "content" in message &&
        typeof message.content === "string"
          ? message.content
          : ""
      ))
      .join("\n");
    expect(scopedInstructions).toContain(`Allowed files: ${targetPath}`);
    expect(scopedInstructions).toContain("Do not modify, validate, or read files outside the listed scope.");

    const assistantMessages = await db
      .select({ role: aiChatMessagesTable.role, toolTrace: aiChatMessagesTable.toolTrace })
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, plan.sessionId));
    const assistantMessage = assistantMessages.find(
      (message) => message.role === "assistant" && message.toolTrace,
    );
    expect(assistantMessage?.toolTrace).toBeTruthy();
    const persistedTrace = JSON.parse(assistantMessage!.toolTrace!) as Array<Record<string, unknown>>;
    expect(persistedTrace.filter((entry) => entry.kind === "repair_state").map((entry) => entry.repairState))
      .toEqual(["VALIDATING", "READY_FOR_REVIEW"]);
    expect(persistedTrace.find((entry) => entry.kind === "validation")).toMatchObject({
      validationStatus: "passed",
      repairState: "READY_FOR_REVIEW",
      validationProfile: "workspace-typecheck",
      validation: {
        status: "passed",
        evidence: {
          evidenceId: expect.any(String),
          observedAt: expect.any(String),
          artifactRef: expect.any(String),
        },
      },
    });
  }, 60_000);

  it("retries a failed validation, applies a bounded repair, and reaches READY_FOR_REVIEW", async () => {
    const workspaceRoot = path.resolve(process.cwd(), "../..");
    const targetPath = "artifacts/dashboard/src/App.tsx";
    const absoluteTargetPath = path.join(workspaceRoot, targetPath);
    const originalContent = await fs.readFile(absoluteTargetPath, "utf8");
    const failingContent = `${originalContent}\nconst brokenRepair: string = 123;\n`;
    const fixedContent = `${originalContent}\n// deterministic repair attempt 2\n`;
    const rootPath = await fs.mkdtemp("/tmp/repair-loop-root-");
    await fs.rm(rootPath, { recursive: true, force: true });
    await fs.symlink(workspaceRoot, rootPath, "dir");
    rootAliases.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, targetPath);

    harness.validationResults.push(
      {
        status: "failed",
        profile: "workspace-typecheck",
        scenario: "Run the workspace TypeScript typecheck.",
        command: "pnpm run typecheck",
        exitCode: 1,
        stdout: "Type error: number is not assignable to string",
        stderr: "",
        failedTests: ["App.tsx: brokenRepair has the wrong type"],
        affectedFiles: [targetPath],
        detail: "The first repair attempt does not typecheck.",
      },
      {
        status: "passed",
        profile: "workspace-typecheck",
        scenario: "Run the workspace TypeScript typecheck.",
        command: "pnpm run typecheck",
        exitCode: 0,
        stdout: "typecheck passed",
        stderr: "",
        failedTests: [],
        affectedFiles: [],
        detail: "The bounded repair now passes validation.",
      },
    );
    harness.responses.push(
      harness.toolResponse("read-1", "read_file", { path: targetPath }),
      harness.toolResponse("write-1", "write_file", {
        path: targetPath,
        content: failingContent,
        reason: "Apply the first bounded repair attempt.",
      }),
      harness.toolResponse("validate-1", "run_validation", { profile: "workspace-typecheck" }),
      harness.toolResponse("read-2", "read_file", { path: targetPath }),
      harness.toolResponse("write-2", "write_file", {
        path: targetPath,
        content: fixedContent,
        reason: "Correct the typecheck failure from validation attempt 1.",
      }),
      harness.toolResponse("validate-2", "run_validation", { profile: "workspace-typecheck" }),
      harness.finalResponse(JSON.stringify({
        response: "The failed validation was repaired and the change is ready for review.",
        sources: [],
      })),
    );

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: [
          "نفذ الإصلاح ثم أعد التحقق",
          "Implementation task: repair the approved change after validation failure.",
          "Done looks like: the corrected pending change passes server-owned validation.",
          `Relevant files: ${targetPath}`,
        ].join("\n"),
      });

    expect(response.status).toBe(200);
    const events = parseSseEvents(response.text);
    const repairStates = events
      .filter((event) => event.type === "repair_state")
      .map((event) => event.state);
    const validationEvents = events.filter((event) => event.type === "validation");
    const doneEvent = events.find((event) => event.type === "done");

    expect(repairStates).toEqual([
      "VALIDATING",
      "REPAIRING",
      "VALIDATING",
      "READY_FOR_REVIEW",
    ]);
    expect(validationEvents).toHaveLength(2);
    expect(validationEvents.map((event) => [event.status, event.repairState, event.attempt]))
      .toEqual([
        ["failed", "REPAIRING", 1],
        ["passed", "READY_FOR_REVIEW", 2],
      ]);
    expect(validationEvents[0]).toMatchObject({
      failedTests: ["App.tsx: brokenRepair has the wrong type"],
      affectedFiles: [targetPath],
    });
    expect(doneEvent).toMatchObject({ proposalId: expect.any(String) });
    const repairedPendingChanges = doneEvent?.pendingChanges as Array<Record<string, unknown>>;
    expect(repairedPendingChanges.some((change) =>
      change.path === targetPath &&
      change.newContent === fixedContent &&
      change.validationProfile === "workspace-typecheck",
    )).toBe(true);
    expect(await fs.readFile(absoluteTargetPath, "utf8")).toBe(originalContent);
    expect(harness.validationResults).toHaveLength(0);
  }, 60_000);

  it("blocks repeated validation without a changed pending patch and emits BLOCKED without a proposal", async () => {
    const workspaceRoot = path.resolve(process.cwd(), "../..");
    const targetPath = "artifacts/dashboard/src/App.tsx";
    const absoluteTargetPath = path.join(workspaceRoot, targetPath);
    const originalContent = await fs.readFile(absoluteTargetPath, "utf8");
    const failingContent = `${originalContent}\nconst permanentlyBroken: string = 123;\n`;
    const rootPath = await fs.mkdtemp("/tmp/repair-loop-root-");
    await fs.rm(rootPath, { recursive: true, force: true });
    await fs.symlink(workspaceRoot, rootPath, "dir");
    rootAliases.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, targetPath);

    harness.validationResults.push({
      status: "failed",
      profile: "workspace-typecheck",
      scenario: "Run the workspace TypeScript typecheck.",
      command: "pnpm run typecheck",
      exitCode: 1,
      stdout: "Type error: number is not assignable to string",
      stderr: "",
      failedTests: ["App.tsx: permanentlyBroken failed on attempt 1"],
      affectedFiles: [targetPath],
      detail: "Validation attempt 1 failed.",
    });
    harness.responses.push(
      harness.toolResponse("read-1", "read_file", { path: targetPath }),
      harness.toolResponse("write-1", "write_file", {
        path: targetPath,
        content: failingContent,
        reason: "Apply the bounded repair candidate.",
      }),
      harness.toolResponse("validate-1", "run_validation", { profile: "workspace-typecheck" }),
      harness.toolResponse("validate-2", "run_validation", { profile: "workspace-typecheck" }),
      harness.finalResponse("BLOCKED: validation remained failed after the maximum repair attempts."),
    );

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: [
          "نفذ الإصلاح وتوقف إذا استمر الفشل",
          "Implementation task: validate the approved repair with the bounded attempt limit.",
          "Done looks like: never claim success when validation remains failed.",
          `Relevant files: ${targetPath}`,
        ].join("\n"),
      });

    expect(response.status).toBe(200);
    const events = parseSseEvents(response.text);
    const repairStates = events
      .filter((event) => event.type === "repair_state")
      .map((event) => event.state);
    const validationEvents = events.filter((event) => event.type === "validation");
    const doneEvent = events.find((event) => event.type === "done");

    expect(repairStates).toEqual(["VALIDATING", "REPAIRING", "BLOCKED"]);
    expect(validationEvents).toHaveLength(2);
    expect(validationEvents.map((event) => [event.status, event.repairState, event.attempt]))
      .toEqual([
        ["failed", "REPAIRING", 1],
        ["blocked", "BLOCKED", 2],
      ]);
    expect(validationEvents[1]).toMatchObject({
      detail: expect.stringContaining("pending changes are identical"),
    });
    expect(doneEvent).toMatchObject({
      pendingChanges: [],
      proposalUnavailable: "Repair changes require a verified validation profile before approval.",
    });
    expect(doneEvent).not.toHaveProperty("proposalId");
    expect(await fs.readFile(absoluteTargetPath, "utf8")).toBe(originalContent);
    expect(harness.validationResults).toHaveLength(0);
  }, 60_000);

  it("blocks an unavailable validator without a proposal, apply path, or source mutation", async () => {
    const workspaceRoot = path.resolve(process.cwd(), "../..");
    const targetPath = "artifacts/dashboard/src/App.tsx";
    const absoluteTargetPath = path.join(workspaceRoot, targetPath);
    const originalContent = await fs.readFile(absoluteTargetPath, "utf8");
    const pendingContent = `${originalContent}\n// validator-unavailable fixture must never apply\n`;
    const rootPath = await fs.mkdtemp("/tmp/repair-loop-root-");
    await fs.rm(rootPath, { recursive: true, force: true });
    await fs.symlink(workspaceRoot, rootPath, "dir");
    rootAliases.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, targetPath);

    harness.validationResults.push({
      status: "unavailable",
      profile: "workspace-typecheck",
      scenario: "Run the workspace TypeScript typecheck.",
      command: "pnpm run typecheck",
      exitCode: null,
      stdout: "",
      stderr: "validator unavailable in the isolated environment",
      failedTests: [],
      changedFiles: [targetPath],
      detail: "The registered validator is unavailable in the isolated environment.",
      evidence: {
        evidenceId: "unavailable-validator-evidence",
        observedAt: new Date().toISOString(),
        artifactRef: "validation-result:unavailable-validator-evidence",
      },
    });
    harness.responses.push(
      harness.toolResponse("read-1", "read_file", { path: targetPath }),
      harness.toolResponse("write-1", "write_file", {
        path: targetPath,
        content: pendingContent,
        reason: "Prepare the bounded repair candidate before verification.",
      }),
      harness.toolResponse("validate-1", "run_validation", { profile: "workspace-typecheck" }),
      harness.finalResponse("BLOCKED: the registered validator is unavailable; no repair can be approved."),
    );

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: [
          "نفذ الإصلاح لكن توقف إذا تعذر التحقق",
          "Implementation task: validate the approved repair with the server-owned validator.",
          "Done looks like: unavailable validation is BLOCKED and never becomes an approval proposal.",
          `Relevant files: ${targetPath}`,
        ].join("\n"),
      });

    expect(response.status).toBe(200);
    const events = parseSseEvents(response.text);
    const repairStates = events
      .filter((event) => event.type === "repair_state")
      .map((event) => event.state);
    const validationEvents = events.filter((event) => event.type === "validation");
    const doneEvent = events.find((event) => event.type === "done");

    expect(repairStates).toEqual(["VALIDATING", "BLOCKED"]);
    expect(validationEvents).toHaveLength(1);
    expect(validationEvents[0]).toMatchObject({
      status: "unavailable",
      repairState: "BLOCKED",
      profile: "workspace-typecheck",
      attempt: 1,
      maxAttempts: 5,
      detail: "The registered validator is unavailable in the isolated environment.",
    });
    expect(doneEvent).toMatchObject({
      pendingChanges: [],
      proposalUnavailable: "Repair changes require a verified validation profile before approval.",
    });
    expect(doneEvent).not.toHaveProperty("proposalId");
    expect(await fs.readFile(absoluteTargetPath, "utf8")).toBe(originalContent);

    const proposals = await db
      .select({ id: aiChangeProposalsTable.id })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.projectId, projectId));
    expect(proposals).toHaveLength(0);
    expect(harness.validationResults).toHaveLength(0);
  }, 60_000);
});