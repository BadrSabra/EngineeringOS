import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  eventsTable,
  rulesTable,
  metricsTable,
} from "@workspace/db";
import { count, desc, eq, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadDashboardWorkSummary } from "../lib/dashboard-work-summary.js";

const router = Router();

type TaskStatusAggregate = {
  status: (typeof tasksTable.$inferSelect)["status"];
  count: number;
  latestUpdatedAt: Date | null;
};

type DashboardMetric = Pick<
  typeof metricsTable.$inferSelect,
  "id" | "projectId" | "timestamp" | "overallScore"
>;

router.get("/dashboard/work-summary", requireAuth, async (req, res) => {
  try {
    return res.json(await loadDashboardWorkSummary(req.userId!));
  } catch (error) {
    console.error("Dashboard work summary unavailable", error);
    return res.status(503).json({
      error: "work_summary_unavailable",
      message: "تعذر قراءة ملخص العمل الآن. لم يُعتبر ذلك غيابًا للعمل.",
    });
  }
});

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
  // The dashboard needs task counts, not task records. Aggregate in
  // PostgreSQL and carry the maximum update timestamp for the freshness
  // watermark instead of transferring the full task history.
  const taskStatusCountsQuery = hasProjects
    ? db
        .select({
          status: tasksTable.status,
          count: count(),
          latestUpdatedAt: max(tasksTable.updatedAt),
        })
        .from(tasksTable)
        .where(inArray(tasksTable.projectId, projectIds))
        .groupBy(tasksTable.status)
    : ([] as TaskStatusAggregate[]);

  // Only the newest two metrics per project can affect score/trend. Rank in
  // SQL with an id tie-breaker so equal timestamps have a deterministic order.
  const latestMetricsQuery = hasProjects
    ? (() => {
        const rankedMetrics = db
          .select({
            id: metricsTable.id,
            projectId: metricsTable.projectId,
            timestamp: metricsTable.timestamp,
            overallScore: metricsTable.overallScore,
            position: sql<number>`row_number() over (
              partition by ${metricsTable.projectId}
              order by ${metricsTable.timestamp} desc, ${metricsTable.id} desc
            )`.as("position"),
          })
          .from(metricsTable)
          .where(inArray(metricsTable.projectId, projectIds))
          .as("ranked_metrics");

        return db
          .select({
            id: rankedMetrics.id,
            projectId: rankedMetrics.projectId,
            timestamp: rankedMetrics.timestamp,
            overallScore: rankedMetrics.overallScore,
          })
          .from(rankedMetrics)
          .where(lte(rankedMetrics.position, 2))
          .orderBy(rankedMetrics.projectId, rankedMetrics.position);
      })()
    : ([] as DashboardMetric[]);

  const [taskStats, recentEvents, allRules, latestMetrics] = await Promise.all([
    taskStatusCountsQuery,

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

    latestMetricsQuery,
  ]);

  // ── Task counts ────────────────────────────────────────────────────────────

  const taskStatusBreakdown: Record<string, number> = {};
  for (const row of taskStats) {
    taskStatusBreakdown[row.status] = row.count;
  }

  const countFor = (status: string) => taskStatusBreakdown[status] ?? 0;
  const activeTaskCount =
    countFor("running") + countFor("verifying") + countFor("queued");
  const completedTaskCount = countFor("completed");
  const failedTaskCount = countFor("failed");

  // ── Per-project metric trends ──────────────────────────────────────────────
  // latestMetrics is grouped by projectId and ordered by row number (ascending),
  // so each project's first entry is latest and second is its previous snapshot.

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

  // A response can be delayed across a reconnect. Expose a server-owned
  // watermark so clients can reject an older snapshot rather than comparing
  // request arrival times.
  const freshnessRevision = [
    ...projects.map((p) => p.updatedAt),
    ...taskStats.flatMap((row) => (row.latestUpdatedAt ? [row.latestUpdatedAt] : [])),
    ...recentEvents.map((event) => event.timestamp),
    ...latestMetrics.map((metric) => metric.timestamp),
    ...allRules.map((rule) => rule.updatedAt),
  ]
    .filter(Boolean)
    .reduce((latest, value) => {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
    }, 0);

  return res.json({
    freshnessRevision: new Date(freshnessRevision).toISOString(),
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
