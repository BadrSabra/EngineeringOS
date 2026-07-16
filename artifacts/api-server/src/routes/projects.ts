import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  eventsTable,
  metricsTable,
  scanJobsTable,
} from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  UpdateProjectParams,
  DeleteProjectParams,
  GetProjectParams,
  GetProjectSummaryParams,
  ScanProjectParams,
  GetScanJobParams,
} from "@workspace/api-zod";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { recordAudit } from "../lib/audit.js";
import { runScanJob } from "../lib/scan-runner.js";
import { heavyJobQueue } from "../lib/job-queue.js";
import {
  requireProjectAccess,
  requireProjectWriteAccess,
} from "../middlewares/requireProjectAccess.js";

const router = Router();

// List projects owned by the requesting user. Scoped by ownerId so no
// authenticated user can enumerate another user's projects.
router.get("/projects", async (req, res) => {
  const requestId = randomUUID();
  const startMs = Date.now();

  // Phase 1 instrumentation — emit a structured log for every GET /projects
  // so failures can be correlated with userId, requestId, and elapsed time.
  res.setHeader("x-request-id", requestId);

  try {
    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.ownerId, req.userId))
      .orderBy(desc(projectsTable.createdAt));

    logger.info(
      {
        requestId,
        userId: req.userId,
        status: 200,
        projectCount: projects.length,
        elapsedMs: Date.now() - startMs,
      },
      "GET /projects completed",
    );

    return res.json(projects);
  } catch (err) {
    logger.error(
      {
        requestId,
        userId: req.userId,
        elapsedMs: Date.now() - startMs,
        err,
      },
      "GET /projects failed",
    );
    return res.status(500).json({ error: "Internal server error", reason: "server_error" });
  }
});

// Create project — ownerId always comes from the authenticated request,
// never from the client body (CreateProjectBody has no ownerId field).
router.post("/projects", async (req, res) => {
  const body = CreateProjectBody.parse(req.body);
  const now = new Date();
  // One correlationId per mutation request — same convention as scans (see
  // scan-runner.ts) — written to both the event and the audit row so the
  // full trace of "what happened because of this request" is one filter
  // away, not just for scans but for every project-mutating operation.
  const correlationId = randomUUID();
  const project = await db
    .insert(projectsTable)
    .values({
      id: randomUUID(),
      ownerId: req.userId,
      ...body,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "ProjectCreated",
    projectId: project[0].id,
    severity: "info",
    message: `Project "${body.name}" registered`,
    correlationId,
  });

  await recordAudit({
    entityType: "project",
    entityId: project[0].id,
    action: "created",
    projectId: project[0].id,
    stateAfter: project[0],
    correlationId,
  });

  return res.status(201).json(project[0]);
});

// Get project
router.get("/projects/:projectId", requireProjectAccess, (req, res) => {
  GetProjectParams.parse(req.params);
  return res.json(req.project);
});

// Update project
router.patch("/projects/:projectId", requireProjectWriteAccess, async (req, res) => {
  const { projectId } = UpdateProjectParams.parse(req.params);
  const body = UpdateProjectBody.parse(req.body);
  const before = req.project!;
  const correlationId = randomUUID();

  const updated = await db
    .update(projectsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projectsTable.id, projectId))
    .returning();
  if (!updated[0]) return res.status(404).json({ error: "Project not found" });

  await recordAudit({
    entityType: "project",
    entityId: projectId,
    action: "updated",
    projectId,
    changedFields: body,
    stateBefore: before,
    stateAfter: updated[0],
    correlationId,
  });

  return res.json(updated[0]);
});

// Delete project
router.delete("/projects/:projectId", requireProjectWriteAccess, async (req, res) => {
  const { projectId } = DeleteProjectParams.parse(req.params);
  const before = req.project!;
  const correlationId = randomUUID();

  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));

  // Fire-and-forget-but-logged: recordAudit is intentionally best-effort (see
  // lib/audit.ts) so an audit-write hiccup here never turns an already-
  // committed delete into a request failure.
  await recordAudit({
    entityType: "project",
    entityId: projectId,
    action: "deleted",
    projectId,
    stateBefore: before,
    correlationId,
  });

  return res.status(204).send();
});

/**
 * Enqueue a project scan — the actual file walk / rule matching / graph
 * extraction / metrics computation is heavy (can be seconds on a large
 * project) and now runs out-of-band via `runScanJob` instead of blocking
 * this request. The route only validates the project exists, creates a
 * `scan_jobs` row, flips the project to "scanning", and returns immediately;
 * clients poll GET /projects/:projectId/scan-jobs/:jobId for the result.
 */
router.post("/projects/:projectId/scan", requireProjectWriteAccess, async (req, res) => {
  const { projectId } = ScanProjectParams.parse(req.params);

  const now = new Date();
  const jobId = randomUUID();

  const [job] = await db
    .insert(scanJobsTable)
    .values({ id: jobId, projectId, status: "queued", createdAt: now })
    .returning();

  await db
    .update(projectsTable)
    .set({ status: "scanning", updatedAt: now })
    .where(eq(projectsTable.id, projectId));

  // Note: this event's correlationId is intentionally the jobId, not a
  // fresh UUID — performScan (scan-runner.ts) generates its own
  // correlationId once the job actually starts running, so "queued" is
  // correlated by the one stable identifier that already exists for it.
  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "ProjectScanQueued",
    projectId,
    severity: "info",
    message: "Scan queued",
    payload: { jobId },
    correlationId: jobId,
  });

  // Fire-and-forget, but bounded: heavyJobQueue caps how many scan/discovery
  // jobs run at once (see job-queue.ts) so a burst of scan requests can't
  // starve the event loop. The job row stays "queued" in the DB for exactly
  // as long as it waits for a free slot — runScanJob flips it to "running"
  // itself, only once it actually starts. runScanJob handles its own errors
  // (see scan-runner.ts) and always records the outcome on the job row, so
  // we intentionally don't await it here.
  heavyJobQueue.enqueue(() => runScanJob(jobId, projectId));

  return res.status(202).json(job);
});

// Get scan job status/result
router.get(
  "/projects/:projectId/scan-jobs/:jobId",
  requireProjectAccess,
  async (req, res) => {
    const { jobId } = GetScanJobParams.parse(req.params);

    const job = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId)).limit(1);
    if (!job[0]) return res.status(404).json({ error: "Scan job not found" });
    if (job[0].projectId !== req.project!.id) {
      return res.status(404).json({ error: "Scan job not found" });
    }

    return res.json(job[0]);
  },
);

// Project summary
router.get("/projects/:projectId/summary", requireProjectAccess, async (req, res) => {
  const { projectId } = GetProjectSummaryParams.parse(req.params);

  const [taskRows, recentEvents, latestMetric] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)),
    db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId))
      .orderBy(desc(eventsTable.timestamp))
      .limit(10),
    db
      .select()
      .from(metricsTable)
      .where(eq(metricsTable.projectId, projectId))
      .orderBy(desc(metricsTable.timestamp))
      .limit(1),
  ]);

  const project = req.project!;

  const taskCounts = {
    total: taskRows.length,
    pending: taskRows.filter(
      (t) => t.status === "pending" || t.status === "queued",
    ).length,
    running: taskRows.filter(
      (t) => t.status === "running" || t.status === "verifying",
    ).length,
    completed: taskRows.filter((t) => t.status === "completed").length,
    failed: taskRows.filter((t) => t.status === "failed").length,
  };

  return res.json({
    projectId,
    qualityScore: project.qualityScore ?? 0,
    taskCounts,
    recentEvents,
    latestMetrics: latestMetric[0] ?? null,
  });
});

export default router;
