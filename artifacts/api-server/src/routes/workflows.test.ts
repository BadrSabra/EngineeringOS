import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  db,
  projectsTable,
  workflowsTable,
  workflowExecutionsTable,
  eventsTable,
  auditLogsTable,
} from "@workspace/db";
import { randomUUID } from "crypto";

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `wf-test-project-${id.slice(0, 8)}`,
    rootPath: "/tmp/wf-test",
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function cleanupProject(id: string): Promise<void> {
  await db.delete(eventsTable).where(eq(eventsTable.projectId, id));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, id));
  const workflows = await db.select().from(workflowsTable).where(eq(workflowsTable.projectId, id));
  for (const wf of workflows) {
    await db.delete(workflowExecutionsTable).where(eq(workflowExecutionsTable.workflowId, wf.id));
  }
  await db.delete(workflowsTable).where(eq(workflowsTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}

describe("Workflow phase orchestration", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  async function createStartedWorkflow() {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const created = await request(app)
      .post("/api/workflows")
      .send({
        projectId,
        name: `wf-${randomUUID().slice(0, 8)}`,
        phases: [{ name: "build", steps: [] }, { name: "test", steps: [] }, { name: "deploy", steps: [] }],
      });
    expect(created.status).toBe(201);
    const workflowId = created.body.id;

    const started = await request(app).post(`/api/workflows/${workflowId}/start`);
    expect(started.status).toBe(202);

    return { projectId, workflowId };
  }

  it("advances through phases in order and completes after the last one", async () => {
    const { workflowId } = await createStartedWorkflow();

    const first = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(first.status).toBe(200);
    expect(first.body.currentPhase).toBe("test");
    expect(first.body.completedPhases).toEqual(["build"]);
    expect(first.body.status).toBe("running");

    const second = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(second.body.currentPhase).toBe("deploy");
    expect(second.body.completedPhases).toEqual(["build", "test"]);

    const third = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(third.body.status).toBe("completed");
    expect(third.body.currentPhase).toBeNull();
    expect(third.body.completedPhases).toEqual(["build", "test", "deploy"]);

    const workflow = await db.select().from(workflowsTable).where(eq(workflowsTable.id, workflowId)).limit(1);
    expect(workflow[0].status).toBe("completed");
    expect(workflow[0].currentPhase).toBeNull();
  });

  it("marks a phase failed and allows retrying it in place", async () => {
    const { workflowId } = await createStartedWorkflow();

    const failed = await request(app)
      .post(`/api/workflows/${workflowId}/fail-phase`)
      .send({ error: "build step exploded" });
    expect(failed.status).toBe(200);
    expect(failed.body.status).toBe("failed");
    expect(failed.body.errorMessage).toBe("build step exploded");
    expect(failed.body.currentPhase).toBe("build");

    const workflowAfterFail = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId))
      .limit(1);
    expect(workflowAfterFail[0].status).toBe("failed");

    const retried = await request(app)
      .post(`/api/workflows/${workflowId}/executions/${failed.body.id}/retry-phase`);
    expect(retried.status).toBe(202);
    expect(retried.body.status).toBe("running");
    expect(retried.body.errorMessage).toBeNull();
    expect(retried.body.currentPhase).toBe("build");

    const workflowAfterRetry = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId))
      .limit(1);
    expect(workflowAfterRetry[0].status).toBe("running");
  });

  it("returns 409 when advancing a workflow with no running execution", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const created = await request(app)
      .post("/api/workflows")
      .send({ projectId, name: `wf-${randomUUID().slice(0, 8)}`, phases: [{ name: "build", steps: [] }] });

    const res = await request(app).post(`/api/workflows/${created.body.id}/advance`);
    expect(res.status).toBe(409);
  });

  // ── PR-D: condition evaluation ──────────────────────────────────────────────

  async function createStartedWorkflowWithCondition(condition: string, qualityScore: number | null = null) {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    // Set a qualityScore on the project so the condition evaluator can read it.
    if (qualityScore !== null) {
      await db.update(projectsTable).set({ qualityScore }).where(eq(projectsTable.id, projectId));
    }

    const created = await request(app)
      .post("/api/workflows")
      .send({
        projectId,
        name: `wf-cond-${randomUUID().slice(0, 8)}`,
        phases: [
          { name: "build", steps: [], condition },
          { name: "deploy", steps: [] },
        ],
      });
    expect(created.status).toBe(201);
    const workflowId = created.body.id;

    const started = await request(app).post(`/api/workflows/${workflowId}/start`);
    expect(started.status).toBe(202);

    return { projectId, workflowId };
  }

  it("blocks advance with 409 when the phase condition is not met (qualityScore too low)", async () => {
    const { workflowId } = await createStartedWorkflowWithCondition("qualityScore >= 80", 60);

    const res = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("condition_not_met");
    expect(res.body.condition).toBe("qualityScore >= 80");
    expect(res.body.blockers).toEqual(["condition_not_met: qualityScore >= 80"]);
    expect(res.body.context.qualityScore).toBe(60);
  });

  it("allows advance when the phase condition is met (qualityScore high enough)", async () => {
    const { workflowId } = await createStartedWorkflowWithCondition("qualityScore >= 80", 90);

    const res = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(res.status).toBe(200);
    expect(res.body.currentPhase).toBe("deploy");
  });

  it("allows advance when the phase has no condition (existing behaviour unchanged)", async () => {
    const { workflowId } = await createStartedWorkflow();

    const res = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(res.status).toBe(200);
  });

  it("returns 400 when the condition expression has a syntax error", async () => {
    const { workflowId } = await createStartedWorkflowWithCondition("qualityScore >=== !!!");

    const res = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("condition_evaluation_error");
    expect(res.body.condition).toBe("qualityScore >=== !!!");
    expect(res.body.hint).toMatch(/qualityScore.*currentPhase.*completedPhases/);
  });

  it("returns 409 when condition evaluates against completedPhases array", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    // Three-phase workflow: phase1 has a condition requiring phase2 already done.
    // Since we just started on phase1, completedPhases is empty → should block.
    const created = await request(app)
      .post("/api/workflows")
      .send({
        projectId,
        name: `wf-phases-${randomUUID().slice(0, 8)}`,
        phases: [
          { name: "phase1", steps: [], condition: "completedPhases.includes('phase0')" },
          { name: "phase2", steps: [] },
        ],
      });
    expect(created.status).toBe(201);
    const workflowId = created.body.id;

    await request(app).post(`/api/workflows/${workflowId}/start`);

    const res = await request(app).post(`/api/workflows/${workflowId}/advance`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("condition_not_met");
  });

  it("returns 409 when retrying an execution that isn't failed", async () => {
    const { workflowId } = await createStartedWorkflow();
    const executions = await db
      .select()
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workflowId, workflowId));
    const runningExecution = executions[0];

    const res = await request(app).post(
      `/api/workflows/${workflowId}/executions/${runningExecution.id}/retry-phase`,
    );
    expect(res.status).toBe(409);
  });
});
