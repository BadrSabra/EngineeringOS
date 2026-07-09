import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  eventsTable,
  metricsTable,
  rulesTable,
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  UpdateProjectParams,
  DeleteProjectParams,
  GetProjectParams,
  GetProjectSummaryParams,
  ScanProjectParams,
} from "@workspace/api-zod";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  walkProject,
  matchRules,
  extractGraph,
  computeMetrics,
  type RuleInput,
} from "@workspace/scanner";

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
  const updated = await db
    .update(projectsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projectsTable.id, projectId))
    .returning();
  if (!updated[0]) return res.status(404).json({ error: "Project not found" });
  return res.json(updated[0]);
});

// Delete project
router.delete("/projects/:projectId", async (req, res) => {
  const { projectId } = DeleteProjectParams.parse(req.params);
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  return res.status(204).send();
});

/**
 * Scan project — real file walker + rule matching + graph extraction + metrics.
 *
 * Rules are scoped to: global rules (projectId IS NULL) + rules explicitly
 * assigned to this project.
 *
 * Error safety: a try/finally always resets project status from "scanning".
 */
router.post("/projects/:projectId/scan", async (req, res) => {
  const { projectId } = ScanProjectParams.parse(req.params);

  const [project, projectRules] = await Promise.all([
    db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1),
    db
      .select()
      .from(rulesTable)
      .where(
        and(
          eq(rulesTable.enabled, true),
          or(isNull(rulesTable.projectId), eq(rulesTable.projectId, projectId)),
        ),
      ),
  ]);
  if (!project[0]) return res.status(404).json({ error: "Project not found" });

  const now = new Date();

  await db
    .update(projectsTable)
    .set({ status: "scanning", updatedAt: now })
    .where(eq(projectsTable.id, projectId));

  try {
    // ── 1. Walk the project directory ──────────────────────────────────────
    const walkResult = await walkProject(project[0].rootPath);
    const { files } = walkResult;

    // ── 2. Match scoped rules against scanned files ─────────────────────────
    const ruleInputs: RuleInput[] = projectRules.map((r) => ({
      id: r.id,
      code: r.code,
      pattern: r.pattern,
      severity: r.severity,
      enabled: r.enabled ?? true,
    }));
    const ruleResults = matchRules(ruleInputs, files);

    // ── 3. Compute quality metrics ──────────────────────────────────────────
    const metrics = computeMetrics(files, ruleResults);

    // ── 4. Create tasks for matched rules (skip if task already exists) ─────
    const existingRuleTasks = await db
      .select({ ruleId: tasksTable.ruleId })
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId));
    const existingRuleTaskIds = new Set(
      existingRuleTasks.map((t) => t.ruleId).filter(Boolean),
    );

    const newTaskIds: string[] = [];
    for (const result of ruleResults) {
      if (!result.matched) continue;
      if (existingRuleTaskIds.has(result.ruleId)) continue;

      const rule = projectRules.find((r) => r.id === result.ruleId);
      if (!rule) continue;

      const taskId = randomUUID();
      const topFiles = result.matches.slice(0, 5).map((m) => m.file);

      await db.insert(tasksTable).values({
        id: taskId,
        projectId,
        ruleId: rule.id,
        title: `Fix: ${rule.title}`,
        description:
          rule.fixDescription ??
          `${result.matchCount} occurrence(s) detected. Top file: ${topFiles[0] ?? "unknown"}`,
        status: "pending",
        priority:
          rule.severity === "critical"
            ? "p0"
            : rule.severity === "high"
              ? "p1"
              : rule.severity === "medium"
                ? "p2"
                : "p3",
        relatedFiles: topFiles,
        createdAt: now,
        updatedAt: now,
      });
      newTaskIds.push(taskId);

      await db
        .update(rulesTable)
        .set({ hitCount: (rule.hitCount ?? 0) + result.matchCount, updatedAt: now })
        .where(eq(rulesTable.id, rule.id));
    }

    // ── 5. Extract and persist knowledge graph ──────────────────────────────
    const graph = extractGraph(files);

    const existingEntities = await db
      .select({ name: graphEntitiesTable.name, type: graphEntitiesTable.type, id: graphEntitiesTable.id })
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.projectId, projectId));

    const entityKeyToId = new Map<string, string>();
    for (const e of existingEntities) {
      entityKeyToId.set(`${e.type}::${e.name}`, e.id);
    }

    const entitiesToInsert = graph.entities.filter(
      (e) => !entityKeyToId.has(`${e.type}::${e.name}`),
    );

    if (entitiesToInsert.length > 0) {
      const entityRows = entitiesToInsert.map((e) => ({
        id: randomUUID(),
        projectId,
        type: e.type,
        name: e.name,
        path: e.path,
        metadata: e.metadata ?? {},
        createdAt: now,
      }));
      await db.insert(graphEntitiesTable).values(entityRows);
      for (const row of entityRows) {
        entityKeyToId.set(`${row.type}::${row.name}`, row.id);
      }
    }

    const findEntityId = (name: string): string | undefined => {
      const fileId = entityKeyToId.get(`file::${name}`);
      if (fileId) return fileId;
      return (
        entityKeyToId.get(`function::${name}`) ??
        entityKeyToId.get(`class::${name}`) ??
        entityKeyToId.get(`module::${name}`)
      );
    };

    const relRows = graph.relationships
      .map((rel) => {
        const sourceId = findEntityId(rel.sourceName);
        const targetId = findEntityId(rel.targetName);
        if (!sourceId || !targetId) return null;
        return {
          id: randomUUID(),
          sourceId,
          targetId,
          relation: rel.relation,
          metadata: {},
          createdAt: now,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (relRows.length > 0) {
      await db.insert(graphRelationshipsTable).values(relRows);
    }

    // ── 6. Insert metrics record ────────────────────────────────────────────
    await db.insert(metricsTable).values({
      id: randomUUID(),
      projectId,
      timestamp: now,
      overallScore: metrics.overallScore,
      securityScore: metrics.securityScore,
      maintainabilityScore: metrics.maintainabilityScore,
      reliabilityScore: metrics.reliabilityScore,
      performanceScore: metrics.performanceScore,
      technicalDebt: metrics.technicalDebt,
      lintIssues: metrics.lintIssues,
    });

    // ── 7. Update project quality score and restore status ──────────────────
    await db
      .update(projectsTable)
      .set({
        status: "active",
        qualityScore: metrics.overallScore,
        lastScanAt: now,
        updatedAt: now,
      })
      .where(eq(projectsTable.id, projectId));

    // ── 8. Emit scan event ──────────────────────────────────────────────────
    const issuesDetected = ruleResults.reduce((s, r) => s + r.matchCount, 0);
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "ProjectScanned",
      projectId,
      severity: "success",
      message: `Scan complete: ${walkResult.totalFiles} files, ${issuesDetected} issues detected`,
      payload: {
        filesFound: walkResult.totalFiles,
        sourceFiles: walkResult.sourceFiles,
        issuesDetected,
        tasksCreated: newTaskIds.length,
        rootExists: walkResult.rootExists,
        entitiesExtracted: entitiesToInsert.length,
        relationshipsExtracted: relRows.length,
        qualityScore: metrics.overallScore,
      },
    });

    return res.status(202).json({
      projectId,
      scannedAt: now.toISOString(),
      rootPath: walkResult.rootPath,
      rootExists: walkResult.rootExists,
      filesFound: walkResult.totalFiles,
      sourceFiles: walkResult.sourceFiles,
      issuesDetected,
      tasksCreated: newTaskIds.length,
      entitiesExtracted: entitiesToInsert.length,
      relationshipsExtracted: relRows.length,
      metrics,
      summary: `Scanned ${walkResult.totalFiles} files. Found ${issuesDetected} issues. Created ${newTaskIds.length} tasks. Quality score: ${metrics.overallScore}/100.`,
    });
  } catch (err) {
    await db
      .update(projectsTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
    throw err;
  }
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
