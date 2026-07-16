import { Router } from "express";
import { db } from "@workspace/db";
import { metricsTable, projectsTable } from "@workspace/db";
import { ListMetricsQueryParams } from "@workspace/api-zod";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";

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
    .orderBy(metricsTable.timestamp);

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

  // No filter — scope to ALL projects the caller owns
  const ownedProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.ownerId, req.userId));

  if (ownedProjects.length === 0) return res.json([]);

  const projectIds = ownedProjects.map((p: { id: string }) => p.id);
  const latestPerProject = await Promise.all(
    projectIds.map(async (pid: string) => {
      const rows = await db
        .select()
        .from(metricsTable)
        .where(eq(metricsTable.projectId, pid))
        .orderBy(desc(metricsTable.timestamp))
        .limit(1);
      return rows[0] ?? null;
    }),
  );

  return res.json(latestPerProject.filter(Boolean));
});

export default router;
