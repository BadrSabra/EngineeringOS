import { Router } from "express";
import { db } from "@workspace/db";
import { metricsTable, projectsTable } from "@workspace/db";
import { ListMetricsQueryParams, GetLatestMetricsQueryParams } from "@workspace/api-zod";
import { eq, and, gte, lte, desc } from "drizzle-orm";

const router = Router();

// Get time-series metrics
router.get("/metrics", async (req, res) => {
  const params = ListMetricsQueryParams.parse(req.query);
  const conditions = [eq(metricsTable.projectId, params.projectId)];
  if (params.from)
    conditions.push(gte(metricsTable.timestamp, new Date(params.from)));
  if (params.to)
    conditions.push(lte(metricsTable.timestamp, new Date(params.to)));

  const records = await db
    .select()
    .from(metricsTable)
    .where(and(...conditions))
    .orderBy(metricsTable.timestamp);
  return res.json(records);
});

// Latest metric per project
router.get("/metrics/latest", async (req, res) => {
  const params = GetLatestMetricsQueryParams.parse(req.query);

  const projects = params.projectId
    ? await db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.id, params.projectId))
    : await db.select().from(projectsTable);

  const results = await Promise.all(
    projects.map(async (project) => {
      const latest = await db
        .select()
        .from(metricsTable)
        .where(eq(metricsTable.projectId, project.id))
        .orderBy(desc(metricsTable.timestamp))
        .limit(1);
      return latest[0] ?? null;
    }),
  );

  return res.json(results.filter(Boolean));
});

export default router;
