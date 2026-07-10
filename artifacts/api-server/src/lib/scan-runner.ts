/**
 * The actual heavy work of a project scan: file walk, rule matching, graph
 * extraction, and metrics computation. Extracted out of the route handler so
 * it can run out-of-band (see routes/projects.ts) instead of blocking the
 * HTTP response for however long a full project scan takes.
 */
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  eventsTable,
  metricsTable,
  rulesTable,
  graphEntitiesTable,
  graphRelationshipsTable,
  scanJobsTable,
} from "@workspace/db";
import { eq, and, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { walkProject, matchRules, extractGraph, computeMetrics, type RuleInput } from "@workspace/scanner";
import { recordAudit } from "./audit.js";
import { logger } from "./logger.js";

export interface ScanJobResult {
  projectId: string;
  scannedAt: string;
  rootPath: string;
  rootExists: boolean;
  filesFound: number;
  sourceFiles: number;
  issuesDetected: number;
  tasksCreated: number;
  entitiesExtracted: number;
  relationshipsExtracted: number;
  summary: string;
}

/**
 * Run a full scan for `projectId` and update the given `jobId`'s row with
 * the outcome. Never throws — failures are recorded on the job row and the
 * project status is always restored, so a bug here can't wedge a project in
 * "scanning" forever or crash the process that enqueued it.
 */
export async function runScanJob(jobId: string, projectId: string): Promise<void> {
  // Everything below is inside one try/catch — including the very first
  // status-flip update — because this function is invoked fire-and-forget
  // (`void runScanJob(...)`) from the route. Any rejection that escapes here
  // would be an unhandled promise rejection in a single-process Express
  // deployment, which can crash the whole process. No await before try.
  try {
    await db
      .update(scanJobsTable)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(scanJobsTable.id, jobId));

    const result = await performScan(projectId);
    await db
      .update(scanJobsTable)
      .set({
        status: "completed",
        result: result as unknown as Record<string, unknown>,
        finishedAt: new Date(),
      })
      .where(eq(scanJobsTable.id, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, projectId, jobId }, "scan job failed");
    try {
      await db
        .update(scanJobsTable)
        .set({ status: "failed", error: message, finishedAt: new Date() })
        .where(eq(scanJobsTable.id, jobId));
      await db
        .update(projectsTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));
    } catch (cleanupErr) {
      // Even the failure-path writes are wrapped: if the DB is unreachable
      // there is nothing more we can safely do in-process, but we must
      // still not throw out of a fire-and-forget call.
      logger.error({ cleanupErr, projectId, jobId }, "failed to record scan job failure");
    }
  }
}

async function performScan(projectId: string): Promise<ScanJobResult> {
  const [project, projectRules] = await Promise.all([
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
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
  if (!project[0]) throw new Error(`Project ${projectId} not found`);

  const now = new Date();

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
  const existingRuleTaskIds = new Set(existingRuleTasks.map((t) => t.ruleId).filter(Boolean));

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
    .select({
      name: graphEntitiesTable.name,
      type: graphEntitiesTable.type,
      id: graphEntitiesTable.id,
      path: graphEntitiesTable.path,
    })
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, projectId));

  // Primary key: type::path::name — prevents cross-file name collisions.
  // Secondary key: type::name → [ids] — for relationship resolution.
  // Multiple entities can share a name across files; we record all IDs and
  // pick the first stable entry so relationships don't shift on re-scan.
  const entityKeyToId = new Map<string, string>(); // type::path::name → id
  const entityNameToIds = new Map<string, string[]>(); // type::name → [id, …]

  function addToNameIndex(type: string, name: string, id: string): void {
    const key = `${type}::${name}`;
    const existing = entityNameToIds.get(key);
    if (existing) {
      existing.push(id);
    } else {
      entityNameToIds.set(key, [id]);
    }
  }

  for (const e of existingEntities) {
    const pk = `${e.type}::${e.path ?? e.name}::${e.name}`;
    entityKeyToId.set(pk, e.id);
    addToNameIndex(e.type, e.name, e.id);
  }

  const entitiesToInsert = graph.entities.filter(
    (e) => !entityKeyToId.has(`${e.type}::${e.path ?? e.name}::${e.name}`),
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
      entityKeyToId.set(`${row.type}::${row.path ?? row.name}::${row.name}`, row.id);
      addToNameIndex(row.type, row.name, row.id);
    }
  }

  // Resolve a relationship endpoint to a DB entity ID.
  // If multiple entities share the same name (cross-file collision),
  // return the first stable entry rather than an arbitrary one.
  const findEntityId = (name: string): string | undefined => {
    for (const type of ["file", "function", "class", "module"] as const) {
      const ids = entityNameToIds.get(`${type}::${name}`);
      if (ids && ids.length > 0) return ids[0];
    }
    return undefined;
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
    architectureScore: metrics.architectureScore,
    securityScore: metrics.securityScore,
    maintainabilityScore: metrics.maintainabilityScore,
    reliabilityScore: metrics.reliabilityScore,
    performanceScore: metrics.performanceScore,
    testCoverage: metrics.testCoverage,
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

  await recordAudit({
    entityType: "project",
    entityId: projectId,
    action: "scanned",
    projectId,
    stateBefore: { qualityScore: project[0].qualityScore ?? null },
    stateAfter: { qualityScore: metrics.overallScore },
    changedFields: {
      filesFound: walkResult.totalFiles,
      tasksCreated: newTaskIds.length,
      entitiesExtracted: entitiesToInsert.length,
      relationshipsExtracted: relRows.length,
    },
  });

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

  return {
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
    summary: `Scanned ${walkResult.totalFiles} files. Found ${issuesDetected} issues. Created ${newTaskIds.length} tasks. Quality score: ${metrics.overallScore}/100.`,
  };
}
