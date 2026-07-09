import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  eventsTable,
  rulesTable,
  metricsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/dashboard", async (_req, res) => {
  const [projects, tasks, recentEvents, allRules, latestMetrics] =
    await Promise.all([
      db.select().from(projectsTable),
      db.select().from(tasksTable),
      db
        .select()
        .from(eventsTable)
        .orderBy(desc(eventsTable.timestamp))
        .limit(20),
      db
        .select()
        .from(rulesTable)
        .orderBy(desc(rulesTable.hitCount))
        .limit(5),
      db.select().from(metricsTable).orderBy(desc(metricsTable.timestamp)),
    ]);

  const activeTaskCount = tasks.filter(
    (t) => t.status === "running" || t.status === "verifying" || t.status === "queued",
  ).length;
  const completedTaskCount = tasks.filter((t) => t.status === "completed").length;
  const failedTaskCount = tasks.filter((t) => t.status === "failed").length;

  const taskStatusBreakdown: Record<string, number> = {};
  for (const task of tasks) {
    taskStatusBreakdown[task.status] =
      (taskStatusBreakdown[task.status] ?? 0) + 1;
  }

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
