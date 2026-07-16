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
import {
  dispatchOnScanComplete,
  type ExtractedEntity,
  type RuleViolationSummary,
} from "./plugin-runtime.js";
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
      // Guard with `status = "scanning"` so a newer job that has already
      // taken ownership of this project is not clobbered by this failure path.
      await db
        .update(projectsTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(projectsTable.id, projectId), eq(projectsTable.status, "scanning")));
    } catch (cleanupErr) {
      // Even the failure-path writes are wrapped: if the DB is unreachable
      // there is nothing more we can safely do in-process, but we must
      // still not throw out of a fire-and-forget call.
      logger.error({ cleanupErr, projectId, jobId }, "failed to record scan job failure");
    }
  }
}

async function performScan(projectId: string): Promise<ScanJobResult> {
  // One UUID per scan operation — written to audit_logs, events, and metrics
  // so a single `WHERE correlation_id = ?` retrieves the complete trace for
  // this scan without relying on projectId + timestamp proximity.
  const correlationId = randomUUID();

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

  // ── 4-8. Persist everything derived from this scan atomically ───────────
  // Tasks, rule hit counts, graph entities/relationships, the metrics row,
  // the project status/score update, the audit record, and the scan event
  // are all effects of the *same* scan. If any one of them fails partway
  // through (e.g. graph insert throws), we must not leave the others
  // committed — that would create tasks with no corresponding metrics row,
  // or a "completed" scan event for a scan that actually failed. Wrapping
  // the whole block in one transaction makes the scan atomic: either all of
  // it lands, or none of it does, and the outer catch in runScanJob marks
  // the job failed with a clean, fully-rolled-back DB state.

  // Captured after the graph is extracted inside the transaction so plugins
  // can inspect the entity list without re-querying the DB.
  let capturedEntities: ExtractedEntity[] = [];

  return await db.transaction(async (tx) => {
    const existingRuleTasks = await tx
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

      await tx.insert(tasksTable).values({
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
        correlationId,
      });
      newTaskIds.push(taskId);

      await tx
        .update(rulesTable)
        .set({ hitCount: (rule.hitCount ?? 0) + result.matchCount, updatedAt: now })
        .where(eq(rulesTable.id, rule.id));
    }

    // ── 5. Extract and persist knowledge graph ────────────────────────────
    const graph = await extractGraph(files);
    // Capture for plugin dispatch outside the transaction (plugin-runtime.ts).
    capturedEntities = graph.entities.map((e) => ({
      type: e.type,
      name: e.name,
      path: e.path,
    }));

    const existingEntities = await tx
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
      // ── Knowledge Graph 2.0 semantic fields ────────────────────────────
      kind: e.kind,
      sourceType: e.sourceType,
      isDocumented: e.isDocumented,
      semanticTags: e.semanticTags,
      description: e.description,
      confidence: e.confidence,
      domain: e.domain,
      lifecycle: e.lifecycle,
      createdAt: now,
    }));
    await tx.insert(graphEntitiesTable).values(entityRows);
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
      const evArr = rel.evidence ?? [];
      return {
        id: randomUUID(),
        sourceId,
        targetId,
        projectId, // denormalised for efficient project-level queries (KG 2.0)
        relation: rel.relation,
        // ── Knowledge Graph 2.0 semantic fields ─────────────────────────
        relationType: rel.relationType,
        relationSubtype: rel.relationSubtype,
        weight: rel.confidence, // weight mirrors confidence by default
        confidence: rel.confidence,
        isHeuristic: rel.isHeuristic ?? false,
        isRuntimeObserved: rel.isRuntimeObserved ?? false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evidenceJson: evArr as any,
        evidenceCount: evArr.length,
        evidenceSummary:
          evArr.length > 0
            ? `${evArr.length} evidence item${evArr.length === 1 ? "" : "s"}`
            : null,
        semanticTags: rel.semanticTags,
        sourceType: rel.sourceType,
        metadata: {},
        createdAt: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (relRows.length > 0) {
    await tx.insert(graphRelationshipsTable).values(relRows);
  }

    // ── 6. Insert metrics record ──────────────────────────────────────────
    await tx.insert(metricsTable).values({
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
      correlationId,
    });

    // ── 7. Update project quality score and restore status ─────────────────
    // Guard with `status = "scanning"` so a concurrent newer job that owns
    // the project is not overwritten if, somehow, two jobs run in overlap.
    await tx
      .update(projectsTable)
      .set({
        status: "active",
        qualityScore: metrics.overallScore,
        lastScanAt: now,
        updatedAt: now,
      })
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.status, "scanning")));

    // ── 8. Emit scan event ───────────────────────────────────────────────
    const issuesDetected = ruleResults.reduce((s, r) => s + r.matchCount, 0);
    await tx.insert(eventsTable).values({
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
      correlationId,
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
      _priorQualityScore: project[0].qualityScore ?? null,
    };
  }).then(async (result) => {
    // Audit is intentionally recorded *after* the transaction commits and
    // outside it (see audit.ts) — it reflects a state change that has
    // already durably happened, and an audit-table outage must not roll
    // back an otherwise-successful scan.
    const { _priorQualityScore, ...scanResult } = result;
    await recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "scanned",
      projectId,
      stateBefore: { qualityScore: _priorQualityScore },
      stateAfter: { qualityScore: scanResult.issuesDetected >= 0 ? metrics.overallScore : null },
      changedFields: {
        filesFound: scanResult.filesFound,
        tasksCreated: scanResult.tasksCreated,
        entitiesExtracted: scanResult.entitiesExtracted,
        relationshipsExtracted: scanResult.relationshipsExtracted,
      },
      correlationId,
    });

    // Dispatch plugin hooks outside the transaction — same best-effort
    // semantics as recordAudit: a plugin failure must not roll back a
    // successful scan. Errors are logged but swallowed here.
    await dispatchOnScanComplete({
      projectId,
      language: project[0].language,
      framework: project[0].framework ?? null,
      filesFound: scanResult.filesFound,
      sourceFiles: scanResult.sourceFiles,
      issuesDetected: scanResult.issuesDetected,
      tasksCreated: scanResult.tasksCreated,
      entitiesExtracted: scanResult.entitiesExtracted,
      relationshipsExtracted: scanResult.relationshipsExtracted,
      ruleViolations: ruleResults
        .filter((r) => r.matched)
        .map((r): RuleViolationSummary => {
          const rule = projectRules.find((pr) => pr.id === r.ruleId);
          return {
            ruleId: r.ruleId,
            code: rule?.code ?? r.ruleId,
            severity: rule?.severity ?? "medium",
            matchCount: r.matchCount,
          };
        }),
      entities: capturedEntities,
    });

    return scanResult;
  });
}
