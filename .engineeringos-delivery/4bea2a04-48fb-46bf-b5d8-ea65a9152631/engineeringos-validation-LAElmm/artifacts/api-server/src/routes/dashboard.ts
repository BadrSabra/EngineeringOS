import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  eventsTable,
  rulesTable,
  metricsTable,
} from "@workspace/db";
import { desc, eq, inArray, isNull, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

/**
 * GET /dashboard
 *
 * Returns an aggregated summary scoped strictly to the authenticated user's
 * own projects. Every query in this handler is filtered by ownerId (for the
 * projects table) or by the set of project IDs that belong to the caller
 * (for tasks, events, metrics, and project-specific rules). A user can
 * never see another user's data through this endpoint.
 *
 * Global rules (rulesTable rows where projectId IS NULL) are visible to all
 * authenticated users because they represent system-wide quality rules, not
 * user-specific data.
 *
 * drizzle-orm's inArray() requires a non-empty array and will throw on an
 * empty one, so every project-scoped query short-circuits to an empty
 * in-process result when the user has no projects yet.
 */
router.get("/dashboard", requireAuth, async (req, res) => {
  const userId = req.userId!;

  // Step 1: load only the projects this user owns — the ownership anchor
  // for every subsequent query in this handler.
  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.ownerId, userId));

  const projectIds = projects.map((p) => p.id);
  const hasProjects = projectIds.length > 0;

  // Step 2: scope remaining queries to the user's project IDs.
  const [tasks, recentEvents, allRules, latestMetrics] = await Promise.all([
    // Tasks are always project-scoped; return empty when the user has no projects.
    hasProjects
      ? db
          .select()
          .from(tasksTable)
          .where(inArray(tasksTable.projectId, projectIds))
      : ([] as (typeof tasksTable.$inferSelect)[]),

    // Events are always project-scoped; capped at 20, newest first.
    hasProjects
      ? db
          .select()
          .from(eventsTable)
          .where(inArray(eventsTable.projectId, projectIds))
          .orderBy(desc(eventsTable.timestamp))
          .limit(20)
      : ([] as (typeof eventsTable.$inferSelect)[]),

    // Rules: show global (projectId = null) rules for all authenticated users,
    // plus any rules tied specifically to this user's projects.
    db
      .select()
      .from(rulesTable)
      .where(
        hasProjects
          ? or(isNull(rulesTable.projectId), inArray(rulesTable.projectId, projectIds))!
          : isNull(rulesTable.projectId),
      )
      .orderBy(desc(rulesTable.hitCount))
      .limit(5),

    // Metrics are project-scoped; newest first for trend calculation.
    hasProjects
      ? db
          .select()
          .from(metricsTable)
          .where(inArray(metricsTable.projectId, projectIds))
          .orderBy(desc(metricsTable.timestamp))
      : ([] as (typeof metricsTable.$inferSelect)[]),
  ]);

  // ── Task counts ────────────────────────────────────────────────────────────

  const activeTaskCount = tasks.filter(
    (t) =>
      t.status === "running" ||
      t.status === "verifying" ||
      t.status === "queued",
  ).length;
  const completedTaskCount = tasks.filter(
    (t) => t.status === "completed",
  ).length;
  const failedTaskCount = tasks.filter((t) => t.status === "failed").length;

  const taskStatusBreakdown: Record<string, number> = {};
  for (const task of tasks) {
    taskStatusBreakdown[task.status] =
      (taskStatusBreakdown[task.status] ?? 0) + 1;
  }

  // ── Per-project metric trends ──────────────────────────────────────────────
  // latestMetrics is sorted newest-first; the first entry per projectId is the
  // latest metric, the second is the previous one used for trend comparison.

  const seenProjects = new Set<string>();
  const latestPerProject = new Map<string, (typeof latestMetrics)[0]>();
  const previousPerProject = new Map<string, (typeof latestMetrics)[0]>();

  for (const metric of latestMetrics) {
    if (!seenProjects.has(metric.projectId)) {
      latestPerProject.set(metric.projectId, metric);
      seenProjects.add(metric.projectId);
    } else if (!previousPerProject.has(metric.projectId)) {
      previousPerProject.set(metric.projectId, metric);
    }
  }

  const projectScores = projects.map((p) => {
    const latest = latestPerProject.get(p.id);
    const previous = previousPerProject.get(p.id);
    const score = latest?.overallScore ?? p.qualityScore ?? 0;
    let trend: "improving" | "stable" | "declining" = "stable";
    if (latest && previous) {
      const diff = latest.overallScore - previous.overallScore;
      if (diff > 2) trend = "improving";
      else if (diff < -2) trend = "declining";
    }
    return { projectId: p.id, projectName: p.name, score, trend };
  });

  const topRules = allRules.map((r) => ({
    ruleId: r.id,
    code: r.code,
    title: r.title,
    hitCount: r.hitCount ?? 0,
  }));

  return res.json({
    projectCount: projects.length,
    activeTaskCount,
    completedTaskCount,
    failedTaskCount,
    recentEvents,
    projectScores,
    taskStatusBreakdown,
    topRules,
  });
});

export default router;
