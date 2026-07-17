/**
 * Smoke tests for ai.ts routes.
 *
 * All AI orchestrator calls are mocked — these tests verify the HTTP contract
 * (request validation, 400/404/409 paths, correct response shape, DB side
 * effects) without hitting the Groq API.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import app from "../app.js";
import {
  db,
  projectsTable,
  tasksTable,
  eventsTable,
  workflowsTable,
  aiChatSessionsTable,
  aiChatMessagesTable,
  taskLogsTable,
  auditLogsTable,
} from "@workspace/db";

// ─── Orchestrator mock ────────────────────────────────────────────────────────
// Every export from @workspace/ai-orchestrator is replaced with a stub that
// returns a predictable, shape-correct response. Tests that need different
// behaviour override individual functions via vi.mocked(...).mockResolvedValue.

vi.mock("@workspace/ai-orchestrator", () => ({
  buildProjectContext: vi.fn(async () => "mocked project context string"),
  chat: vi.fn(async () => ({
    response: "AI response text",
    sources: ["metrics", "tasks"],
  })),
  analyzeScan: vi.fn(async () => ({
    summary: "Analysis complete",
    insights: [{ priority: "high", category: "security", title: "Mock insight", description: "desc", recommendation: "fix it" }],
    overallHealthAssessment: "good",
    immediateActions: [],
    longTermRecommendations: [],
  })),
  reviewCode: vi.fn(async () => ({
    verdict: "approved",
    overallScore: 85,
    summary: "Looks good",
    issues: [],
    strengths: ["Clean code"],
    criticalIssues: 0,
    highIssues: 0,
    mediumIssues: 0,
    lowIssues: 0,
  })),
  orchestrateWorkflow: vi.fn(async () => ({
    action: "advance",
    reasoning: "All conditions met",
    confidence: "high",
    blockers: [],
    suggestedNextPhase: null,
  })),
  executeTask: vi.fn(async () => ({
    summary: "Task completed by AI",
    confidence: "high",
    steps: ["Analyzed the codebase", "Applied fix"],
    needsHumanReview: false,
    agentResponse: "Done",
    filesModified: [],
  })),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `ai-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/ai-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertTask(projectId: string, status = "pending"): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(tasksTable).values({
    id,
    projectId,
    title: `AI task ${id.slice(0, 6)}`,
    description: "A task for AI to execute",
    status: status as "pending",
    priority: "p2",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertWorkflow(projectId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(workflowsTable).values({
    id,
    projectId,
    name: `AI Workflow ${id.slice(0, 6)}`,
    status: "running",
    phases: [{ name: "Phase 1", steps: ["step-a"] }, { name: "Phase 2", steps: ["step-b"] }],
    currentPhase: "Phase 1",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

const projectIds: string[] = [];
const workflowIds: string[] = [];

// All AI routes require a Groq API key. Set a dummy env key for the entire
// test file — every AI orchestrator call is mocked so the real key is never
// used.  Individual tests that want to verify the 428 path remove the key
// themselves and restore it in a finally block.
let _savedGroqKeyFileLevel: string | undefined;
beforeAll(() => {
  _savedGroqKeyFileLevel = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
});
afterAll(() => {
  if (_savedGroqKeyFileLevel !== undefined) {
    process.env.GROQ_API_KEY = _savedGroqKeyFileLevel;
  } else {
    delete process.env.GROQ_API_KEY;
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const pid of projectIds.splice(0)) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, pid)).catch(() => undefined);
    await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, pid)).catch(() => undefined); // may not match, that's fine
    await db.delete(eventsTable).where(eq(eventsTable.projectId, pid)).catch(() => undefined);
    await db.delete(aiChatMessagesTable)
      .where(
        eq(
          aiChatMessagesTable.sessionId,
          db
            .select({ id: aiChatSessionsTable.id })
            .from(aiChatSessionsTable)
            .where(eq(aiChatSessionsTable.projectId, pid))
            .limit(1) as unknown as string,
        ),
      )
      .catch(() => undefined);
    // Clean sessions for this project
    const sessions = await db
      .select({ id: aiChatSessionsTable.id })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.projectId, pid));
    for (const s of sessions) {
      await db
        .delete(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.sessionId, s.id))
        .catch(() => undefined);
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, pid)).catch(() => undefined);
    await db.delete(tasksTable).where(eq(tasksTable.projectId, pid)).catch(() => undefined);
    for (const wid of workflowIds.splice(0)) {
      await db.delete(workflowsTable).where(eq(workflowsTable.id, wid)).catch(() => undefined);
    }
    await db.delete(projectsTable).where(eq(projectsTable.id, pid)).catch(() => undefined);
  }
  // Also clear any lingering workflow ids
  for (const wid of workflowIds.splice(0)) {
    await db.delete(workflowsTable).where(eq(workflowsTable.id, wid)).catch(() => undefined);
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────

describe("POST /api/ai/chat", () => {
  it("returns 400 when projectId is missing", async () => {
    const res = await request(app).post("/api/ai/chat").send({ message: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it("returns 400 when message is missing", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it("returns 400 when message is blank", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId: randomUUID(), message: "   " });
    expect(res.status).toBe(400);
  });

  it("creates a session and returns sessionId + message on first chat", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "What is the quality of this project?" });
    expect(res.status).toBe(200);
    expect(typeof res.body.sessionId).toBe("string");
    expect(res.body.message).toBeDefined();
    expect(res.body.message.role).toBe("assistant");
    expect(res.body.message.content).toBe("AI response text");
    expect(Array.isArray(res.body.sources)).toBe(true);
  });

  it("reuses an existing session when sessionId is provided", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // First message creates a session
    const first = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Hello" });
    expect(first.status).toBe(200);
    const { sessionId } = first.body;

    // Second message reuses it
    const second = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Follow-up", sessionId });
    expect(second.status).toBe(200);
    expect(second.body.sessionId).toBe(sessionId);

    // DB: session has messages from both turns
    const messages = await db
      .select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, sessionId));
    // 2 user + 2 assistant = 4 messages
    expect(messages.length).toBe(4);
  });
});

// ─── GET /api/ai/chat/sessions ────────────────────────────────────────────────

describe("GET /api/ai/chat/sessions", () => {
  it("returns 400 when projectId is missing", async () => {
    const res = await request(app).get("/api/ai/chat/sessions");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it("returns 200 with sessions for a project", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Create a session via chat
    await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Session list test" });

    const res = await request(app).get(`/api/ai/chat/sessions?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].projectId).toBe(projectId);
  });

  it("returns an empty array for a project with no sessions", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).get(`/api/ai/chat/sessions?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── GET /api/ai/chat/:sessionId/messages ─────────────────────────────────────

describe("GET /api/ai/chat/:sessionId/messages", () => {
  it("returns an empty array for an unknown session (not 404)", async () => {
    // The route does not 404 — it returns the messages for the session (empty).
    const res = await request(app).get(`/api/ai/chat/${randomUUID()}/messages`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns messages in chronological order", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const chatRes = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Chrono test" });
    const { sessionId } = chatRes.body;

    const res = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2); // user + assistant
    expect(res.body[0].role).toBe("user");
    expect(res.body[1].role).toBe("assistant");
  });
});

// ─── POST /api/ai/projects/:projectId/analyze ─────────────────────────────────

describe("POST /api/ai/projects/:projectId/analyze", () => {
  it("returns 200 with analysis result", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).post(`/api/ai/projects/${projectId}/analyze`);
    expect(res.status).toBe(200);
    expect(typeof res.body.summary).toBe("string");
    expect(Array.isArray(res.body.insights)).toBe(true);
  });

  it("creates an AiScanAnalysisCompleted event", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    await request(app).post(`/api/ai/projects/${projectId}/analyze`);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const ev = events.find((e) => e.type === "AiScanAnalysisCompleted");
    expect(ev).toBeDefined();
  });
});

// ─── POST /api/ai/projects/:projectId/review ──────────────────────────────────

describe("POST /api/ai/projects/:projectId/review", () => {
  it("returns 200 with code review result", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post(`/api/ai/projects/${projectId}/review`)
      .send({ fileContents: { "index.ts": "const x = 1;" } });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("approved");
    expect(typeof res.body.overallScore).toBe("number");
  });

  it("creates an AiCodeReviewCompleted event", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    await request(app).post(`/api/ai/projects/${projectId}/review`).send({});

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const ev = events.find((e) => e.type === "AiCodeReviewCompleted");
    expect(ev).toBeDefined();
    expect(ev?.severity).toBe("success"); // verdict === "approved"
  });
});

// ─── POST /api/ai/workflows/:workflowId/orchestrate ───────────────────────────

describe("POST /api/ai/workflows/:workflowId/orchestrate", () => {
  it("returns 404 for an unknown workflow", async () => {
    const res = await request(app)
      .post(`/api/ai/workflows/${randomUUID()}/orchestrate`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Workflow not found");
  });

  it("returns 200 with an orchestration decision for a known workflow", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const workflowId = await insertWorkflow(projectId);
    workflowIds.push(workflowId);

    const res = await request(app)
      .post(`/api/ai/workflows/${workflowId}/orchestrate`)
      .send({ additionalContext: "all tests passing" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("advance");
    expect(typeof res.body.reasoning).toBe("string");
  });

  it("creates an AiWorkflowOrchestration event", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const workflowId = await insertWorkflow(projectId);
    workflowIds.push(workflowId);

    await request(app).post(`/api/ai/workflows/${workflowId}/orchestrate`).send({});

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const ev = events.find((e) => e.type === "AiWorkflowOrchestration");
    expect(ev).toBeDefined();
  });
});

// ─── POST /api/ai/tasks/:taskId/execute ──────────────────────────────────────

describe("POST /api/ai/tasks/:taskId/execute", () => {
  // executeTask is mocked — a real key is never sent to Groq.
  // We set a dummy env key so requireGroqApiKey passes the availability check;
  // the 428-without-key test explicitly deletes it and restores it in finally.
  let savedGroqKey: string | undefined;
  beforeAll(() => {
    savedGroqKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
  });
  afterAll(() => {
    if (savedGroqKey !== undefined) {
      process.env.GROQ_API_KEY = savedGroqKey;
    } else {
      delete process.env.GROQ_API_KEY;
    }
  });

  it("returns 404 for an unknown task", async () => {
    const res = await request(app).post(`/api/ai/tasks/${randomUUID()}/execute`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Task not found");
  });

  it("returns 409 for a completed task", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "completed");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/completed/i);
  });

  it("returns 409 for a failed task", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "failed");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/failed/i);
  });

  it("executes a pending task and returns 202 with updated status", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    // needsHumanReview: false → finalStatus: "completed"
    expect(res.body.status).toBe("completed");
    expect(typeof res.body.agentResponse).toBe("string");
  });

  it("sets task status to 'verifying' when AI says needsHumanReview", async () => {
    const { executeTask: mockExecuteTask } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockExecuteTask).mockResolvedValueOnce({
      summary: "Needs review",
      result: "",
      confidence: "low",
      steps: [],
      needsHumanReview: true,
    });

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verifying");
  });

  it("creates task logs and an event on successful execution", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    await request(app).post(`/api/ai/tasks/${taskId}/execute`);

    const logs = await db
      .select()
      .from(taskLogsTable)
      .where(eq(taskLogsTable.taskId, taskId));
    expect(logs.length).toBeGreaterThanOrEqual(2); // start + finish

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const execEvent = events.find((e) => e.taskId === taskId);
    expect(execEvent).toBeDefined();
    expect(["TaskCompleted", "TaskVerifying"]).toContain(execEvent?.type);
  });

  it("creates an audit entry on execution", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    await request(app).post(`/api/ai/tasks/${taskId}/execute`);

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, taskId));
    const auditEntry = audits.find((a) => a.action === "ai_executed");
    expect(auditEntry).toBeDefined();
  });

  it("returns 428 and leaves task in original status when no Groq API key is configured", async () => {
    // Regression: the key check must happen BEFORE the atomic claim so the task
    // is never left stuck in "running" when no key is configured.
    const savedKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    try {
      const projectId = await insertProject();
      projectIds.push(projectId);
      const taskId = await insertTask(projectId, "pending");

      const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
      // No key → 428 Precondition Required
      expect(res.status).toBe(428);

      // Task must never have entered "running" — the key check precedes the claim.
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .limit(1);
      expect(task?.status).toBe("pending");
    } finally {
      if (savedKey !== undefined) process.env.GROQ_API_KEY = savedKey;
    }
  });
});
