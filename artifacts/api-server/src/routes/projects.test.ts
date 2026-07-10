import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { db, projectsTable, eventsTable, metricsTable, tasksTable, auditLogsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import * as scanner from "@workspace/scanner";

async function insertProject(rootPath: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    name: `test-project-${id.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function cleanupProject(id: string): Promise<void> {
  await db.delete(tasksTable).where(eq(tasksTable.projectId, id));
  await db.delete(metricsTable).where(eq(metricsTable.projectId, id));
  await db.delete(eventsTable).where(eq(eventsTable.projectId, id));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}

describe("POST /api/projects/:projectId/scan — error safety", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("resets project status to active even when the root path does not exist", async () => {
    const projectId = await insertProject("/tmp/definitely-does-not-exist-" + randomUUID());
    cleanupQueue.push(projectId);

    // walkProject on a missing path does not throw (rootExists: false), so the
    // scan should still complete successfully rather than getting stuck in "scanning".
    const res = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res.status).toBe(202);

    const project = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(project[0]?.status).toBe("active");

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, projectId));
    const scanAudit = audits.find((a) => a.action === "scanned");
    expect(scanAudit).toBeDefined();
    expect(scanAudit?.entityType).toBe("project");
    expect(scanAudit?.projectId).toBe(projectId);
  });

  it("resets project status to active when the scan pipeline throws mid-scan", async () => {
    const projectId = await insertProject("/tmp/scan-throw-test-" + randomUUID());
    cleanupQueue.push(projectId);

    vi.spyOn(scanner, "extractGraph").mockImplementation(() => {
      throw new Error("simulated scanner failure");
    });

    const res = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res.status).toBe(500);

    const project = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    // The route's try/finally-style catch must restore "active" even though
    // the pipeline threw partway through — it must never get stuck in "scanning".
    expect(project[0]?.status).toBe("active");
  });

  it("returns 404 when scanning a project that does not exist", async () => {
    const res = await request(app).post(`/api/projects/${randomUUID()}/scan`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects — audit trail", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("records a project_created audit entry with stateAfter", async () => {
    const res = await request(app)
      .post("/api/projects")
      .send({ name: `audit-test-${randomUUID()}`, rootPath: "/tmp/audit-test", language: "typescript" });
    expect(res.status).toBe(201);
    cleanupQueue.push(res.body.id);

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, res.body.id));
    expect(audits).toHaveLength(1);
    expect(audits[0].entityType).toBe("project");
    expect(audits[0].action).toBe("created");
    expect((audits[0].stateAfter as { name?: string } | null)?.name).toBe(res.body.name);
  });
});

describe("GET /api/projects/:projectId/summary", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns aggregated task counts and 404s for unknown project", async () => {
    const projectId = await insertProject("/tmp/summary-test-" + randomUUID());
    cleanupQueue.push(projectId);

    const res = await request(app).get(`/api/projects/${projectId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.taskCounts).toEqual({
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    });

    const notFound = await request(app).get(`/api/projects/${randomUUID()}/summary`);
    expect(notFound.status).toBe(404);
  });
});
