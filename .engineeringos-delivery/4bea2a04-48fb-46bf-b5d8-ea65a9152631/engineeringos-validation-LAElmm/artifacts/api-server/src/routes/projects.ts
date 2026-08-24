import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  browserValidationProfilesTable,
  tasksTable,
  eventsTable,
  metricsTable,
  scanJobsTable,
  aiExecutionsTable,
  workflowsTable,
  workflowExecutionsTable,
  aiChangeProposalsTable,
} from "@workspace/db";
import { z } from "zod";
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
import { eq, desc, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { recordAuditInTransaction } from "../lib/audit.js";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { runScanJob } from "../lib/scan-runner.js";
import { establishProjectRoot } from "../lib/project-root.js";
import { heavyJobQueue } from "../lib/job-queue.js";
import { removeManagedProjectRoot } from "../lib/project-materialization.js";
import {
  requireProjectAccess,
  requireProjectWriteAccess,
} from "../middlewares/requireProjectAccess.js";
import { parsePagination } from "../lib/pagination.js";
import {
  BROWSER_PROFILE_LIMITS,
  PREVIEW_LIMITS,
  validateRegisteredBrowserProfile,
  type PreviewStep,
} from "../lib/browser-preview-verification.js";

const router = Router();

const BrowserStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), path: z.string().min(1).max(500).regex(/^\/(?!\/)/) }).strict(),
  z.object({ type: z.literal("assert_visible"), selector: z.string().min(1).max(BROWSER_PROFILE_LIMITS.maxSelectorChars) }).strict(),
  z.object({ type: z.literal("assert_text"), selector: z.string().min(1).max(BROWSER_PROFILE_LIMITS.maxSelectorChars), text: z.string().min(1).max(BROWSER_PROFILE_LIMITS.maxTextChars) }).strict(),
  z.object({ type: z.literal("read_visible_text"), selector: z.string().min(1).max(BROWSER_PROFILE_LIMITS.maxSelectorChars).optional() }).strict(),
  z.object({ type: z.literal("screenshot"), name: z.string().min(1).max(80) }).strict(),
]);
const BrowserProfileBody = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
  steps: z.array(BrowserStepSchema).min(1).max(PREVIEW_LIMITS.maxSteps),
  timeoutMs: z.number().int().min(1).max(PREVIEW_LIMITS.maxValidationMs).default(PREVIEW_LIMITS.maxValidationMs),
}).strict();

function publicBrowserProfile(
  profile: typeof browserValidationProfilesTable.$inferSelect,
  currentRevision: string,
) {
  const isFresh = profile.revision === currentRevision;
  return {
    id: profile.id, projectId: profile.projectId, name: profile.name,
    revision: profile.revision, permittedOrigin: profile.permittedOrigin,
    steps: profile.steps, timeoutMs: profile.timeoutMs,
    createdAt: profile.createdAt, updatedAt: profile.updatedAt,
    currentRevision,
    freshnessStatus: isFresh ? "fresh" as const : "stale" as const,
    freshnessReason: isFresh ? null : "stale_revision" as const,
  };
}

// List projects owned by the requesting user. Scoped by ownerId so no
// authenticated user can enumerate another user's projects.
router.get("/projects", async (req, res) => {
  const requestId = randomUUID();
  const startMs = Date.now();

  // Phase 1 instrumentation — emit a structured log for every GET /projects
  // so failures can be correlated with userId, requestId, and elapsed time.
  res.setHeader("x-request-id", requestId);

  try {
    const pagination = parsePagination(req, { defaultPageSize: 50, maxPageSize: 200 });
    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.ownerId, req.userId))
      .orderBy(desc(projectsTable.createdAt), desc(projectsTable.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset);

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

// Project-owned browser checks. The revision and Preview origin are derived
// server-side; callers can only register the bounded, declarative steps.
router.get("/projects/:projectId/browser-validation-profiles", requireProjectAccess, async (req, res) => {
  const rows = await db.select().from(browserValidationProfilesTable)
    .where(eq(browserValidationProfilesTable.projectId, req.project!.id))
    .orderBy(desc(browserValidationProfilesTable.updatedAt));
  const currentRevision = req.project!.updatedAt.toISOString();
  return res.json(rows.map((profile) => publicBrowserProfile(profile, currentRevision)));
});

router.put("/projects/:projectId/browser-validation-profiles/:name", requireProjectWriteAccess, async (req, res) => {
  const body = BrowserProfileBody.parse({ ...req.body, name: req.params.name });
  const project = req.project!;
  const profile = {
    name: body.name,
    revision: project.updatedAt.toISOString(),
    permittedOrigin: "http://127.0.0.1:4300",
    steps: body.steps as PreviewStep[],
    timeoutMs: body.timeoutMs,
  };
  try {
    validateRegisteredBrowserProfile(profile);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid browser validation profile",
      reason: "validation_error",
    });
  }
  const existing = await db.select({ name: browserValidationProfilesTable.name })
    .from(browserValidationProfilesTable)
    .where(eq(browserValidationProfilesTable.projectId, project.id));
  const replacing = existing.some((row) => row.name === body.name);
  if (existing.length >= BROWSER_PROFILE_LIMITS.maxProfiles && !replacing) {
    return res.status(400).json({
      error: `A project may have at most ${BROWSER_PROFILE_LIMITS.maxProfiles} browser validation profiles.`,
      reason: "browser_profile_limit",
    });
  }
  const now = new Date();
  const [saved] = await db.insert(browserValidationProfilesTable).values({
    id: randomUUID(), projectId: project.id, ...profile, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [browserValidationProfilesTable.projectId, browserValidationProfilesTable.name],
    set: { revision: profile.revision, permittedOrigin: profile.permittedOrigin, steps: profile.steps, timeoutMs: profile.timeoutMs, updatedAt: now },
  }).returning();
  return res.json(publicBrowserProfile(saved, project.updatedAt.toISOString()));
});

router.delete("/projects/:projectId/browser-validation-profiles/:name", requireProjectWriteAccess, async (req, res) => {
  await db.delete(browserValidationProfilesTable).where(and(
    eq(browserValidationProfilesTable.projectId, req.project!.id),
    eq(browserValidationProfilesTable.name, String(req.params.name)),
  ));
  return res.status(204).send();
});

// Create project — ownerId always comes from the authenticated request,
// never from the client body (CreateProjectBody has no ownerId field).
router.post("/projects", async (req, res) => {
  const body = CreateProjectBody.parse(req.body);

  // Establish a trustworthy canonical root BEFORE anything is persisted.
  // The client-supplied rootPath is only a candidate — it must exist, be a
  // readable directory, resolve (via realpath) inside the allowed boundary,
  // and contain at least one recognisable project marker.
  const rootResult = await establishProjectRoot(body.rootPath, { requireMarkers: true });
  if (!rootResult.ok) {
    return res
      .status(rootResult.status)
      .json({ error: rootResult.error, reason: rootResult.reason });
  }

  const now = new Date();
  // One correlationId per mutation request — same convention as scans (see
  // scan-runner.ts) — written to both the event and the audit row so the
  // full trace of "what happened because of this request" is one filter
  // away, not just for scans but for every project-mutating operation.
  const correlationId = randomUUID();
  const project = await db.transaction(async (tx) => {
    const [created] = await tx.insert(projectsTable).values({
      id: randomUUID(), ownerId: req.userId, ...body,
      rootPath: rootResult.canonicalPath, status: "active",
      createdAt: now, updatedAt: now,
    }).returning();
    await tx.insert(eventsTable).values({
      id: randomUUID(), type: "ProjectCreated", projectId: created.id,
      severity: "info", message: `Project "${body.name}" registered`, correlationId,
    });
    await recordAuditInTransaction(tx, {
      entityType: "project", entityId: created.id, action: "created",
      projectId: created.id, stateAfter: created, correlationId,
    });
    return [created];
  });

  invalidateContextCache(project[0].id);

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

  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(projectsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId)).returning();
    if (rows[0]) {
      await tx.insert(eventsTable).values({
        id: randomUUID(), type: "ProjectUpdated", projectId,
        severity: "info", message: `Project "${rows[0].name}" updated`, correlationId,
        payload: { changedFields: body },
      });
      await recordAuditInTransaction(tx, {
        entityType: "project", entityId: projectId, action: "updated",
        projectId, changedFields: body, stateBefore: before,
        stateAfter: rows[0], correlationId,
      });
    }
    return rows;
  });
  if (!updated[0]) return res.status(404).json({ error: "Project not found" });

  invalidateContextCache(projectId);

  return res.json(updated[0]);
});

// Delete project
router.delete("/projects/:projectId", requireProjectWriteAccess, async (req, res) => {
  const { projectId } = DeleteProjectParams.parse(req.params);
  const before = req.project!;
  const correlationId = randomUUID();

  const [activeScan, activeExecution, activeWorkflow, activeDelivery] = await Promise.all([
    db.select({ id: scanJobsTable.id }).from(scanJobsTable).where(and(
      eq(scanJobsTable.projectId, projectId),
      inArray(scanJobsTable.status, ["queued", "running"]),
    )).limit(1),
    db.select({ id: aiExecutionsTable.id }).from(aiExecutionsTable).where(and(
      eq(aiExecutionsTable.projectId, projectId),
      inArray(aiExecutionsTable.status, ["queued", "running", "paused", "cancelling"]),
    )).limit(1),
    db.select({ id: workflowExecutionsTable.id }).from(workflowExecutionsTable)
      .innerJoin(workflowsTable, eq(workflowExecutionsTable.workflowId, workflowsTable.id))
      .where(and(
        eq(workflowsTable.projectId, projectId),
        eq(workflowExecutionsTable.status, "running"),
      )).limit(1),
    db.select({ id: aiChangeProposalsTable.id }).from(aiChangeProposalsTable).where(and(
      eq(aiChangeProposalsTable.projectId, projectId),
      inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"]),
    )).limit(1),
  ]);
  if (activeScan.length || activeExecution.length || activeWorkflow.length || activeDelivery.length) {
    return res.status(409).json({
      error: "project_active_work",
      reason: "Stop or reconcile active scans, deliveries, workflows, and AI executions before deleting this project.",
    });
  }

  await db.transaction(async (tx) => {
    await recordAuditInTransaction(tx, {
      entityType: "project", entityId: projectId, action: "deleted", projectId,
      stateBefore: before, correlationId,
    });
    await tx.insert(eventsTable).values({
      id: randomUUID(), type: "ProjectDeleted", projectId,
      severity: "info", message: `Project "${before.name}" deleted`, correlationId,
    });
    await tx.delete(projectsTable).where(eq(projectsTable.id, projectId));
  });

  // Imported Git/archive projects own their durable materialized root.
  // Direct projects point at user-owned directories and are intentionally
  // left untouched; the marker + managed-directory check makes this explicit.
  try {
    const removed = await removeManagedProjectRoot(before.rootPath);
    if (removed) {
      logger.info(
        { projectId, rootPath: before.rootPath },
        "Removed managed durable project root after project deletion",
      );
    }
  } catch (err) {
    logger.warn(
      { err, projectId, rootPath: before.rootPath },
      "Project deleted but managed durable root cleanup failed",
    );
  }

  invalidateContextCache(projectId);

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

  let job: typeof scanJobsTable.$inferSelect;
  try {
    job = await db.transaction(async (tx) => {
      const [createdJob] = await tx
        .insert(scanJobsTable)
        .values({ id: jobId, projectId, status: "queued", createdAt: now })
        .returning();

      await tx
        .update(projectsTable)
        .set({ status: "scanning", updatedAt: now })
        .where(eq(projectsTable.id, projectId));

      // Note: this event's correlationId is intentionally the jobId, not a
      // fresh UUID — performScan (scan-runner.ts) generates its own
      // correlationId once the job actually starts running, so "queued" is
      // correlated by the one stable identifier that already exists for it.
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "ProjectScanQueued",
        projectId,
        severity: "info",
        message: "Scan queued",
        payload: { jobId },
        correlationId: jobId,
      });

      return createdJob;
    });
  } catch (err) {
    logger.error({ err, projectId, jobId }, "failed to create scan job");
    return res.status(500).json({ error: "Failed to queue scan job" });
  }

  // Fire-and-forget, but bounded: heavyJobQueue caps how many scan/discovery
  // jobs run at once (see job-queue.ts) so a burst of scan requests can't
  // starve the event loop.  The job row stays "queued" in the DB for exactly
  // as long as it waits for a free slot — runScanJob flips it to "running"
  // itself, only once it actually starts. runScanJob handles its own errors
  // (see scan-runner.ts) and always records the outcome on the job row, so
  // we intentionally don't await it here.
  // PR-D1: use enqueueWithId so the stale-pending sweep can skip this job
  // if it re-fires before the closure has had a chance to execute.
  try {
    heavyJobQueue.enqueueWithId(jobId, () => runScanJob(jobId, projectId));
  } catch (enqueueErr) {
    logger.error({ enqueueErr, projectId, jobId }, "failed to enqueue scan job");
    await db.transaction(async (tx) => {
      await tx
        .update(scanJobsTable)
        .set({
          status: "failed",
          error: "Failed to queue scan job",
          finishedAt: new Date(),
        })
        .where(eq(scanJobsTable.id, jobId));

      await tx
        .update(projectsTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "ProjectScanFailed",
        projectId,
        severity: "warning",
        message: "Failed to enqueue scan job",
        correlationId: jobId,
      });
    }).catch(() => {});
    invalidateContextCache(projectId);
    return res.status(500).json({ error: "Failed to queue scan job" });
  }

  invalidateContextCache(projectId);

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
