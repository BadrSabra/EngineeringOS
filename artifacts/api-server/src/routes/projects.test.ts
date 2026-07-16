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
import { heavyJobQueue } from "../lib/job-queue.js";

async function insertProject(rootPath: string, ownerId = "test-user"): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId,
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

    // scan-runner's catch block does two sequential DB updates: job→"failed"
    // then project→"active". waitForScanJob unblocks as soon as it sees
    // "failed" (step 1), which can race the project reset (step 2). A brief
    // wait lets both writes commit before we assert on the project row.
    await new Promise((r) => setTimeout(r, 100));

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

  it("bounds concurrent execution when a burst of scans is triggered at once", async () => {
    const projectIds = await Promise.all(
      Array.from({ length: 6 }, () => insertProject("/tmp/burst-test-" + randomUUID())),
    );
    projectIds.forEach((id) => cleanupQueue.push(id));

    let maxObservedActive = 0;
    const sampler = setInterval(() => {
      maxObservedActive = Math.max(maxObservedActive, heavyJobQueue.activeCount);
    }, 2);

    try {
      const responses = await Promise.all(
        projectIds.map((id) => request(app).post(`/api/projects/${id}/scan`)),
      );
      for (const res of responses) {
        expect(res.status).toBe(202);
      }

      const jobs = await Promise.all(responses.map((res) => waitForScanJob(res.body.id)));
      for (const job of jobs) {
        expect(job.status).toBe("completed");
      }
    } finally {
      clearInterval(sampler);
    }

    // The route enqueues onto the shared, concurrency-limited heavyJobQueue
    // (see job-queue.ts) instead of firing all 6 jobs unbounded — this is
    // the whole point of moving scans off the request path via a bounded
    // queue rather than raw fire-and-forget.
    expect(maxObservedActive).toBeGreaterThan(0);
    expect(maxObservedActive).toBeLessThanOrEqual(2);
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

describe("POST /api/projects/:projectId/scan — DB side-effects", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("creates exactly one metrics row when the scan completes successfully", async () => {
    const projectId = await insertProject("/tmp/definitely-does-not-exist-" + randomUUID());
    cleanupQueue.push(projectId);

    const res = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res.status).toBe(202);
    await waitForScanJob(res.body.id);

    const metrics = await db
      .select()
      .from(metricsTable)
      .where(eq(metricsTable.projectId, projectId));
    expect(metrics).toHaveLength(1);
    expect(typeof metrics[0].overallScore).toBe("number");
  });

  it("creates a ProjectScanned event when the scan completes", async () => {
    const projectId = await insertProject("/tmp/definitely-does-not-exist-" + randomUUID());
    cleanupQueue.push(projectId);

    const res = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res.status).toBe(202);
    await waitForScanJob(res.body.id);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const scanEvent = events.find((e) => e.type === "ProjectScanned");
    expect(scanEvent).toBeDefined();
    expect(scanEvent?.severity).toBe("success");
  });

  it("does not create a metrics row or ProjectScanned event when the scan fails", async () => {
    const projectId = await insertProject("/tmp/scan-throw-test-" + randomUUID());
    cleanupQueue.push(projectId);

    vi.spyOn(scanner, "extractGraph").mockImplementation(() => {
      throw new Error("simulated scanner failure");
    });

    const res = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res.status).toBe(202);
    await waitForScanJob(res.body.id);

    const metrics = await db
      .select()
      .from(metricsTable)
      .where(eq(metricsTable.projectId, projectId));
    expect(metrics).toHaveLength(0);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const scanEvent = events.find((e) => e.type === "ProjectScanned");
    expect(scanEvent).toBeUndefined();
  });

  it("GET scan-jobs/:jobId returns the completed job with a result field", async () => {
    const projectId = await insertProject("/tmp/definitely-does-not-exist-" + randomUUID());
    cleanupQueue.push(projectId);

    const scanRes = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(scanRes.status).toBe(202);
    const jobId = scanRes.body.id;
    await waitForScanJob(jobId);

    const res = await request(app).get(`/api/projects/${projectId}/scan-jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.status).toBe("completed");
    expect(res.body.result).not.toBeNull();
    expect(typeof (res.body.result as Record<string, unknown>).filesFound).toBe("number");
    expect(typeof (res.body.result as Record<string, unknown>).rootExists).toBe("boolean");
  });

  it("second scan on the same project produces a second metrics row", async () => {
    const projectId = await insertProject("/tmp/definitely-does-not-exist-" + randomUUID());
    cleanupQueue.push(projectId);

    const res1 = await request(app).post(`/api/projects/${projectId}/scan`);
    await waitForScanJob(res1.body.id);

    // Project must be back to "active" before second scan is accepted
    const res2 = await request(app).post(`/api/projects/${projectId}/scan`);
    expect(res2.status).toBe(202);
    await waitForScanJob(res2.body.id);

    const metrics = await db
      .select()
      .from(metricsTable)
      .where(eq(metricsTable.projectId, projectId));
    expect(metrics.length).toBe(2);
  });
});

describe("Project ownership scoping (PR-02/PR-03)", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("stamps ownerId from the authenticated request on create, ignoring any client-supplied value", async () => {
    const res = await request(app)
      .post("/api/projects")
      .send({
        name: `owner-stamp-test-${randomUUID()}`,
        rootPath: `/tmp/owner-stamp-${randomUUID()}`,
        language: "typescript",
        ownerId: "someone-else",
      });
    expect(res.status).toBe(201);
    cleanupQueue.push(res.body.id);
    expect(res.body.ownerId).toBe("test-user");
  });

  it("GET /projects only lists projects owned by the requesting user", async () => {
    const ownedId = await insertProject("/tmp/owned-" + randomUUID(), "test-user");
    const otherId = await insertProject("/tmp/other-" + randomUUID(), "someone-else");
    cleanupQueue.push(ownedId, otherId);

    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    const ids: string[] = res.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(ownedId);
    expect(ids).not.toContain(otherId);
  });

  it("GET a project not owned by the requester returns 403, not the record", async () => {
    const otherId = await insertProject("/tmp/other-get-" + randomUUID(), "someone-else");
    cleanupQueue.push(otherId);

    const res = await request(app).get(`/api/projects/${otherId}`);
    expect(res.status).toBe(403);
  });

  it("PATCH a project not owned by the requester returns 403 and does not mutate it", async () => {
    const otherId = await insertProject("/tmp/other-patch-" + randomUUID(), "someone-else");
    cleanupQueue.push(otherId);

    const res = await request(app)
      .patch(`/api/projects/${otherId}`)
      .send({ name: "hijacked" });
    expect(res.status).toBe(403);

    const row = await db.select().from(projectsTable).where(eq(projectsTable.id, otherId)).limit(1);
    expect(row[0]?.name).not.toBe("hijacked");
  });

  it("DELETE a project not owned by the requester returns 403 and does not delete it", async () => {
    const otherId = await insertProject("/tmp/other-delete-" + randomUUID(), "someone-else");
    cleanupQueue.push(otherId);

    const res = await request(app).delete(`/api/projects/${otherId}`);
    expect(res.status).toBe(403);

    const row = await db.select().from(projectsTable).where(eq(projectsTable.id, otherId)).limit(1);
    expect(row[0]).toBeDefined();
  });

  it("POST scan on a project not owned by the requester returns 403 and never enqueues a job", async () => {
    const otherId = await insertProject("/tmp/other-scan-" + randomUUID(), "someone-else");
    cleanupQueue.push(otherId);

    const res = await request(app).post(`/api/projects/${otherId}/scan`);
    expect(res.status).toBe(403);

    const jobs = await db.select().from(scanJobsTable).where(eq(scanJobsTable.projectId, otherId));
    expect(jobs).toHaveLength(0);
  });

  it("GET summary on a project not owned by the requester returns 403", async () => {
    const otherId = await insertProject("/tmp/other-summary-" + randomUUID(), "someone-else");
    cleanupQueue.push(otherId);

    const res = await request(app).get(`/api/projects/${otherId}/summary`);
    expect(res.status).toBe(403);
  });

  it("GET a scan-job belonging to a project the requester doesn't own returns 403", async () => {
    const otherId = await insertProject("/tmp/other-job-" + randomUUID(), "someone-else");
    cleanupQueue.push(otherId);
    const jobId = randomUUID();
    await db.insert(scanJobsTable).values({
      id: jobId,
      projectId: otherId,
      status: "completed",
      createdAt: new Date(),
    });

    const res = await request(app).get(`/api/projects/${otherId}/scan-jobs/${jobId}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 (not 403) for a projectId that does not exist at all", async () => {
    const res = await request(app).get(`/api/projects/${randomUUID()}`);
    expect(res.status).toBe(404);
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
