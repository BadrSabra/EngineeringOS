import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  db,
  projectsTable,
  eventsTable,
  metricsTable,
  tasksTable,
  auditLogsTable,
  scanJobsTable,
} from "@workspace/db";
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
  await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}

/** Scans now run out-of-band; poll the job row until it leaves queued/running. */
async function waitForScanJob(
  jobId: string,
  timeoutMs = 5000,
): Promise<typeof scanJobsTable.$inferSelect> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId)).limit(1);
    if (rows[0] && (rows[0].status === "completed" || rows[0].status === "failed")) {
      return rows[0];
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`scan job ${jobId} did not finish within ${timeoutMs}ms`);
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

  it("queues a scan job immediately, then resolves to active with an audit entry", async () => {
    const projectId = await insertProject("/tmp/definitely-does-not-exist-" + randomUUID());
    cleanupQueue.push(projectId);

    // The route must respond immediately with a queued job rather than
    // blocking on the scan itself.
    const res = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.body.projectId).toBe(projectId);

    const scanningProject = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(scanningProject[0]?.status).toBe("scanning");

    // walkProject on a missing path does not throw (rootExists: false), so the
    // background job should still complete successfully rather than getting
    // stuck in "scanning".
    const job = await waitForScanJob(res.body.id);
    expect(job.status).toBe("completed");
    expect((job.result as { rootExists?: boolean } | null)?.rootExists).toBe(false);

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

  it("marks the job failed and resets project status to active when the scan pipeline throws mid-scan", async () => {
    const projectId = await insertProject("/tmp/scan-throw-test-" + randomUUID());
    cleanupQueue.push(projectId);

    vi.spyOn(scanner, "extractGraph").mockImplementation(() => {
      throw new Error("simulated scanner failure");
    });

    const res = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res.status).toBe(202);

    const job = await waitForScanJob(res.body.id);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("simulated scanner failure");

    const project = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    // The job's own catch must restore "active" even though the pipeline
    // threw partway through — it must never get stuck in "scanning".
    expect(project[0]?.status).toBe("active");
  });

  it("returns 404 when scanning a project that does not exist", async () => {
    const res = await request(app).post(`/api/projects/${randomUUID()}/scan`);
    expect(res.status).toBe(404);
  });

  it("GET scan-jobs/:jobId 404s for an unknown job", async () => {
    const projectId = await insertProject("/tmp/job-404-test-" + randomUUID());
    cleanupQueue.push(projectId);

    const res = await request(app).get(
      `/api/projects/${projectId}/scan-jobs/${randomUUID()}`,
    );
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
