import { Router } from "express";
import { db } from "@workspace/db";
import { metricsTable, projectsTable } from "@workspace/db";
import { ListMetricsQueryParams } from "@workspace/api-zod";
import { eq, and, gte, lte, desc, getTableColumns } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";
import { parsePagination } from "../lib/pagination.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

/**
 * GET /metrics
 *
 * Time-series metrics for a single project. Ownership verified before returning
 * any rows. Supports from/to date range filtering.
 */
router.get("/metrics", async (req, res) => {
  const params = ListMetricsQueryParams.parse(req.query);
  const pagination = parsePagination(req, { defaultPageSize: 100, maxPageSize: 500 });

  // Ownership check — same 400/404/403 semantics as requireProjectAccess
  const project = await loadProjectByIdForUser(params.projectId, req.userId, res);
  if (!project) return; // response already sent

  const conditions = [eq(metricsTable.projectId, project.id)];
  if (params.from) conditions.push(gte(metricsTable.timestamp, new Date(params.from)));
  if (params.to) conditions.push(lte(metricsTable.timestamp, new Date(params.to)));

  const records = await db
    .select()
    .from(metricsTable)
    .where(and(...conditions))
    .orderBy(metricsTable.timestamp, metricsTable.id)
    .limit(pagination.pageSize)
    .offset(pagination.offset);

  return res.json(records);
});

/**
 * GET /metrics/latest
 *
 * Latest metric snapshot per project. Results are always scoped to projects
 * the caller owns — even without a projectId filter, only their own projects
 * are included. If projectId is provided, it is additionally ownership-verified.
 */
router.get("/metrics/latest", async (req, res) => {
  const projectIdFilter =
    typeof req.query.projectId === "string" ? req.query.projectId : undefined;

  if (projectIdFilter) {
    // Single-project request — verify ownership first
    const project = await loadProjectByIdForUser(projectIdFilter, req.userId, res);
    if (!project) return; // response already sent

    const latest = await db
      .select()
      .from(metricsTable)
      .where(eq(metricsTable.projectId, project.id))
      .orderBy(desc(metricsTable.timestamp))
      .limit(1);

    return res.json(latest[0] ? [latest[0]] : []);
  }

  // Join ownership into the same statement as the metric lookup. The inner
  // join preserves the previous behavior: only owned projects with metrics
  // appear, while projects without a snapshot contribute no row.
  // DISTINCT ON keeps the newest metric per project; the id tie-breaker makes
  // equal-timestamp snapshots deterministic.
  const latestPerProject = await db
    .selectDistinctOn([metricsTable.projectId], getTableColumns(metricsTable))
    .from(metricsTable)
    .innerJoin(
      projectsTable,
      and(
        eq(metricsTable.projectId, projectsTable.id),
        eq(projectsTable.ownerId, req.userId),
      ),
    )
    .orderBy(
      metricsTable.projectId,
      desc(metricsTable.timestamp),
      desc(metricsTable.id),
    );

  // DISTINCT ON requires projectId as the first ORDER BY expression. Restore
  // the API's global newest-first presentation after the bounded result set
  // (at most one row per owned project) has been selected.
  latestPerProject.sort((left, right) =>
    right.timestamp.getTime() - left.timestamp.getTime()
    || right.id.localeCompare(left.id),
  );

  return res.json(latestPerProject);
});

export default router;
