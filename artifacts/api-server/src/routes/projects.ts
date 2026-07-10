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
import { recordAudit } from "../lib/audit.js";
import { runScanJob } from "../lib/scan-runner.js";

const router = Router();

// List all projects
router.get("/projects", async (_req, res) => {
  const projects = await db
    .select()
    .from(projectsTable)
    .orderBy(desc(projectsTable.createdAt));
  return res.json(projects);
});

// Create project
router.post("/projects", async (req, res) => {
  const body = CreateProjectBody.parse(req.body);
  const now = new Date();
  const project = await db
    .insert(projectsTable)
    .values({
      id: randomUUID(),
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
  });

  await recordAudit({
    entityType: "project",
    entityId: project[0].id,
    action: "created",
    projectId: project[0].id,
    stateAfter: project[0],
  });

  return res.status(201).json(project[0]);
});

// Get project
router.get("/projects/:projectId", async (req, res) => {
  const { projectId } = GetProjectParams.parse(req.params);
  const project = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project[0]) return res.status(404).json({ error: "Project not found" });
  return res.json(project[0]);
});

// Update project
router.patch("/projects/:projectId", async (req, res) => {
  const { projectId } = UpdateProjectParams.parse(req.params);
  const body = UpdateProjectBody.parse(req.body);

  const before = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!before[0]) return res.status(404).json({ error: "Project not found" });

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
    stateBefore: before[0],
    stateAfter: updated[0],
  });

  return res.json(updated[0]);
});

// Delete project
router.delete("/projects/:projectId", async (req, res) => {
  const { projectId } = DeleteProjectParams.parse(req.params);

  const before = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));

  // Fire-and-forget-but-logged: recordAudit is intentionally best-effort (see
  // lib/audit.ts) so an audit-write hiccup here never turns an already-
  // committed delete into a request failure.
  if (before[0]) {
    await recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "deleted",
      projectId,
      stateBefore: before[0],
    });
  }

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
router.post("/projects/:projectId/scan", async (req, res) => {
  const { projectId } = ScanProjectParams.parse(req.params);

  const project = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project[0]) return res.status(404).json({ error: "Project not found" });

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

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "ProjectScanQueued",
    projectId,
    severity: "info",
    message: "Scan queued",
    payload: { jobId },
  });

  // Fire-and-forget: runScanJob handles its own errors (see scan-runner.ts)
  // and always records the outcome on the job row, so we intentionally
  // don't await it here — the whole point is not blocking this response.
  void runScanJob(jobId, projectId);

  return res.status(202).json(job);
});

// Get scan job status/result
router.get("/projects/:projectId/scan-jobs/:jobId", async (req, res) => {
  const { jobId } = GetScanJobParams.parse(req.params);

  const job = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId)).limit(1);
  if (!job[0]) return res.status(404).json({ error: "Scan job not found" });

  return res.json(job[0]);
});

// Project summary
router.get("/projects/:projectId/summary", async (req, res) => {
  const { projectId } = GetProjectSummaryParams.parse(req.params);

  const [project, taskRows, recentEvents, latestMetric] = await Promise.all([
    db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1),
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

  if (!project[0]) return res.status(404).json({ error: "Project not found" });

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
    qualityScore: project[0].qualityScore ?? 0,
    taskCounts,
    recentEvents,
    latestMetrics: latestMetric[0] ?? null,
  });
});

export default router;
