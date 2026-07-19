/**
 * Context Builder — queries the DB to build rich project context strings
 * that are injected into every agent's system prompt.
 *
 * Internally, all data is retained as structured objects/arrays and sorted by
 * priority/recency before being serialised into the string fields that
 * AgentContextSchema requires.  No fetched field is silently discarded.
 */
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  metricsTable,
  graphEntitiesTable,
  graphRelationshipsTable,
  eventsTable,
  workflowsTable,
  scanJobsTable,
} from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import type { AgentContext } from "./schemas/context.schema.js";

/** The context object every agent prompt is built from. Shape is enforced at runtime by `AgentContextSchema`. */
export type ProjectContext = AgentContext;

// Priority rank map: lower number = higher urgency (P0 is most urgent).
const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

// ── G-11: TTL context cache ───────────────────────────────────────────────────
// 7 parallel DB queries fire on every single chat message.  A 30-second
// in-process cache eliminates the vast majority of redundant reads during an
// active conversation while keeping context fresh enough for any real change
// (task update, scan completion, etc.) to surface within one turn.
const CONTEXT_CACHE_TTL_MS = 30_000;
const contextCache = new Map<string, { data: ProjectContext; expiresAt: number }>();

/**
 * Invalidate the cached context for a project immediately.
 * Call after any write that changes context-relevant data — e.g. applying AI
 * file changes, completing a scan, or updating a task.
 */
export function invalidateContextCache(projectId: string): void {
  contextCache.delete(projectId);
}

export async function buildProjectContext(projectId: string): Promise<ProjectContext> {
  // Return cached context when it is still fresh.
  const now = Date.now();
  const cached = contextCache.get(projectId);
  if (cached && cached.expiresAt > now) return cached.data;
  // Promise.allSettled instead of Promise.all: a single flaky DB connection
  // no longer kills the entire context. The project row is critical — we throw
  // if that query fails. All other tables degrade gracefully to empty arrays so
  // agents receive a partial-but-valid context rather than a raw 500.
  const [
    projectResult, tasksResult, metricsResult, entitiesResult,
    eventsResult, workflowsResult, scanJobResult, relationshipsResult,
  ] = await Promise.allSettled([
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    // Sort in the DB by priority ASC (p0 < p1 < p2 < p3 lexically), then by
    // recency DESC as a tiebreaker.  This ensures a P0 task that hasn't been
    // touched in weeks is never cut before lower-priority recently-updated tasks.
    db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)).orderBy(asc(tasksTable.priority), desc(tasksTable.updatedAt)).limit(10),
    db.select().from(metricsTable).where(eq(metricsTable.projectId, projectId)).orderBy(desc(metricsTable.timestamp)).limit(1),
    // Order by confidence DESC so the most certain entities fill the cap first.
    db.select().from(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId)).orderBy(desc(graphEntitiesTable.confidence)).limit(60),
    db.select().from(eventsTable).where(eq(eventsTable.projectId, projectId)).orderBy(desc(eventsTable.timestamp)).limit(10),
    db.select().from(workflowsTable).where(eq(workflowsTable.projectId, projectId)).orderBy(desc(workflowsTable.updatedAt)).limit(20),
    // Fetch scan job to distinguish real scans from import-time defaults.
    db.select({ status: scanJobsTable.status, error: scanJobsTable.error, finishedAt: scanJobsTable.finishedAt })
      .from(scanJobsTable).where(eq(scanJobsTable.projectId, projectId)).orderBy(desc(scanJobsTable.createdAt)).limit(1),
    // Gap-1 fix: load relationships so the AI sees graph topology (edges), not
    // just entity nodes. Capped at 40 high-confidence edges.
    db.select({
      id: graphRelationshipsTable.id,
      sourceId: graphRelationshipsTable.sourceId,
      targetId: graphRelationshipsTable.targetId,
      relation: graphRelationshipsTable.relation,
      relationType: graphRelationshipsTable.relationType,
      confidence: graphRelationshipsTable.confidence,
      isHeuristic: graphRelationshipsTable.isHeuristic,
    }).from(graphRelationshipsTable)
      .where(eq(graphRelationshipsTable.projectId, projectId))
      .orderBy(desc(graphRelationshipsTable.confidence))
      .limit(40),
  ]);

  // Helper: returns the fulfilled value or an empty array, logging a warning
  // so degraded contexts are visible in server logs.
  function settled<T>(result: PromiseSettledResult<T[]>, label: string): T[] {
    if (result.status === "fulfilled") return result.value;
    console.warn(
      JSON.stringify({ scope: "context-builder", code: "QUERY_DEGRADED", query: label, projectId, error: String(result.reason) }),
    );
    return [];
  }

  // Project is critical — a query failure is a hard error, not a degradation.
  if (projectResult.status === "rejected") {
    console.error(
      JSON.stringify({ scope: "context-builder", code: "PROJECT_QUERY_FAILED", projectId, error: String(projectResult.reason) }),
    );
    throw new Error(`Failed to load project ${projectId}: ${projectResult.reason}`);
  }

  const [project]       = projectResult.value;
  const rawTasks        = settled(tasksResult,         "tasks");
  const [latestMetric]  = settled(metricsResult,       "metrics");
  const entities        = settled(entitiesResult,      "graphEntities");
  const recentEvents    = settled(eventsResult,        "events");
  const rawWorkflows    = settled(workflowsResult,     "workflows");
  const [latestScanJob] = settled(scanJobResult,       "scanJobs");
  const relationships   = settled(relationshipsResult, "graphRelationships");

  if (!project) throw new Error(`Project ${projectId} not found`);

  // ── Scan reliability ──────────────────────────────────────────────────────
  // Determines whether metrics and graph data come from a real scan or are
  // import-time defaults. The AI must know when it is working with unverified
  // data so it does not present placeholder scores as factual measurements.
  const scanVerified = latestScanJob?.status === "completed";
  const scanFailed   = latestScanJob?.status === "failed";
  const scanPending  = latestScanJob?.status === "queued" || latestScanJob?.status === "running";
  const scanLabel = scanVerified
    ? "completed"
    : scanFailed
      ? `FAILED (${latestScanJob.error?.slice(0, 80) ?? "unknown error"})`
      : scanPending
        ? latestScanJob.status
        : "never run";

  // ── Project ────────────────────────────────────────────────────────────────
  const lastScan = project.lastScanAt
    ? project.lastScanAt.toISOString().slice(0, 10)
    : "never";
  const qualityNote = scanVerified
    ? project.qualityScore?.toFixed(1) ?? "N/A"
    : `${project.qualityScore?.toFixed(1) ?? "N/A"} ⚠ unverified`;
  const projectParts: string[] = [
    `Name: ${project.name}`,
    `Language: ${project.language}${project.framework ? ` / ${project.framework}` : ""}`,
    `Status: ${project.status}`,
    `Quality: ${qualityNote}/100`,
    `Path: ${project.rootPath}`,
    `Last scan: ${lastScan} [${scanLabel}]`,
  ];
  // Include description only when present — it is often empty on new projects.
  if (project.description) projectParts.push(`Description: ${project.description}`);

  // Git remote — tells the agent what GitHub repo backs this project so it can
  // reason about commits, pushes, and branch context without calling git_status.
  if (project.gitRemoteUrl) {
    const branch = project.gitDefaultBranch ?? "main";
    projectParts.push(`Git remote: ${project.gitRemoteUrl} (branch: ${branch})`);
  } else {
    projectParts.push(`Git remote: not configured — user can add one in the GitHub panel`);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  // DB query already orders by priority ASC, updatedAt DESC and limits to 10,
  // so rawTasks arrives in the correct display order. The in-memory sort is
  // kept as a safety net for any edge-case that slips through (e.g. unknown
  // priority strings that the DB sorts differently from PRIORITY_RANK).
  const sortedTasks = [...rawTasks]
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 99;
      const pb = PRIORITY_RANK[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })
    .slice(0, 10);

  const taskLines = sortedTasks.map((t) => {
    const head = `[${t.status.toUpperCase()}] ${t.title} (${t.priority})`;
    const extras: string[] = [];
    if (t.phase) extras.push(`phase: ${t.phase}`);
    if ((t.relatedFiles ?? []).length > 0) extras.push(`${(t.relatedFiles ?? []).length} file(s)`);
    const suffix = extras.length > 0 ? ` [${extras.join(", ")}]` : "";
    const body = t.description ? ` — ${t.description.slice(0, 100)}` : "";
    return `- ${head}${suffix}${body}`;
  });

  const taskSummary = taskLines.length > 0 ? taskLines.join("\n") : "No tasks yet";

  // ── Metrics ────────────────────────────────────────────────────────────────
  // Every column of the metrics row is represented; nullable fields are shown
  // as "N/A" rather than omitted so agents know the data exists but is absent.
  // إصلاح: نُميّز بين المقاييس الحقيقية (من مسح ناجح) والقيم الافتراضية (من الاستيراد).
  // النموذج يجب أن يعرف عندما يعمل بقيم غير موثوقة حتى لا يقدّمها كنتائج فعلية.
  let metricsSummary: string;
  if (latestMetric) {
    const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(1) : "N/A");
    const fmtInt = (v: number | null | undefined) => (v != null ? String(v) : "N/A");
    const asOf = latestMetric.timestamp.toISOString().slice(0, 10);

    const parts: string[] = [
      `Overall: ${fmt(latestMetric.overallScore)}/100`,
      `Arch: ${fmt(latestMetric.architectureScore)}`,
      `Sec: ${fmt(latestMetric.securityScore)}`,
      `Perf: ${fmt(latestMetric.performanceScore)}`,
      `Reliability: ${fmt(latestMetric.reliabilityScore)}`,
      `Maintainability: ${fmt(latestMetric.maintainabilityScore)}`,
      `TechDebt: ${fmt(latestMetric.technicalDebt)}`,
      `Build: ${latestMetric.buildStatus ?? "unknown"}`,
    ];

    // Test and coverage fields are grouped for readability.
    if (latestMetric.testsTotal != null) {
      parts.push(`Tests: ${fmtInt(latestMetric.testsPassed)}/${fmtInt(latestMetric.testsTotal)} passed`);
    }
    if (latestMetric.testCoverage != null) {
      parts.push(`Coverage: ${fmt(latestMetric.testCoverage)}%`);
    }
    if (latestMetric.lintIssues != null) {
      parts.push(`LintIssues: ${latestMetric.lintIssues}`);
    }

    parts.push(`(as of ${asOf})`);
    const rawMetrics = parts.join(" | ");

    // أضف تحذيراً صريحاً إذا لم يكن المسح ناجحاً — القيم قد تكون مُعيَّنة مسبقاً
    // وليست نتيجة تحليل حقيقي للكود.
    metricsSummary = scanVerified
      ? rawMetrics
      : `${rawMetrics}\n⚠ WARNING: These metrics were NOT produced by a successful scan. They are placeholder values set at import time and do NOT reflect real code analysis. Do NOT present them to the user as actual quality measurements. Tell the user to run a scan first.`;
  } else {
    metricsSummary = "No metrics available yet — a scan has not been run for this project.";
  }

  // ── Knowledge graph ────────────────────────────────────────────────────────
  // Entities arrive ordered by confidence DESC (most certain first).
  // Group by type, preserving that ordering within each group, then cap at
  // 20 per type so no single type dominates the summary.
  type Entity = (typeof entities)[number];
  const entityGroups: Record<string, Entity[]> = {};
  for (const e of entities) {
    (entityGroups[e.type] ??= []).push(e);
  }

  const shownIds = new Set<string>();
  const entityLines: string[] = [];

  for (const [type, group] of Object.entries(entityGroups)) {
    const members = group
      .filter((e) => !shownIds.has(e.id))
      .slice(0, 20)
      .map((e) => {
        shownIds.add(e.id);
        const file = e.path ? ` (${e.path.replace(/^.*[\\/]/, "")})` : "";
        // Show sub-kind when available (e.g. "arrow-function", "async-class").
        const kind = e.kind ? ` <${e.kind}>` : "";
        // Confidence as a percentage gives agents a signal on AST vs regex quality.
        const conf = e.confidence != null ? ` [${(e.confidence * 100).toFixed(0)}%]` : "";
        // Business domain helps agents reason about coupling between areas.
        const domain = e.domain ? ` {${e.domain}}` : "";
        const desc = e.description ? ` — ${e.description.slice(0, 60)}` : "";
        return `  • ${e.name}${kind}${file}${conf}${domain}${desc}`;
      });

    if (members.length > 0) {
      entityLines.push(`${type} (${group.length}):\n${members.join("\n")}`);
    }
    if (shownIds.size >= 50) break;
  }

  // ── Graph Relationships (topology) ──────────────────────────────────────
  // Build a name-lookup from already-fetched entities so we can show human-
  // readable "A → calls → B" lines instead of bare UUIDs. Entities outside
  // the 60-row cap appear as truncated IDs — still useful for tracing.
  const entityNameById = new Map<string, string>(entities.map((e) => [e.id, e.name]));
  const relLines: string[] = [];
  for (const r of relationships) {
    const src = entityNameById.get(r.sourceId) ?? r.sourceId.slice(0, 8);
    const tgt = entityNameById.get(r.targetId) ?? r.targetId.slice(0, 8);
    const label = r.relationType ?? r.relation;
    const conf = r.confidence != null ? ` [${(r.confidence * 100).toFixed(0)}%]` : "";
    const heuristic = r.isHeuristic ? " [heuristic]" : "";
    relLines.push(`  • ${src} → ${label} → ${tgt}${conf}${heuristic}`);
  }
  const relSummary =
    relLines.length > 0
      ? `\nRelationships (${relationships.length} shown):\n${relLines.join("\n")}`
      : "";

  const graphSummary =
    entities.length > 0
      ? `${entities.length} entities total:\n${entityLines.join("\n")}${relSummary}`
      : "Knowledge graph empty — run a scan first";

  // ── Events ────────────────────────────────────────────────────────────────
  // Arrive ordered by timestamp DESC (most recent first).
  // Timestamp is now included so agents can reason about staleness.
  const eventLines = recentEvents.map((e) => {
    const ts = e.timestamp.toISOString().slice(0, 16).replace("T", " ");
    // D-05: include entity references so agents can correlate events to the
    // tasks/workflows listed in the context.  Previously taskId, workflowId,
    // and correlationId were dropped, making "TaskCompleted" events anonymous.
    const refs: string[] = [];
    if (e.taskId)       refs.push(`task:${e.taskId.slice(0, 8)}`);
    if (e.workflowId)   refs.push(`wf:${e.workflowId.slice(0, 8)}`);
    if (e.correlationId) refs.push(`corr:${e.correlationId.slice(0, 8)}`);
    const refStr = refs.length > 0 ? ` [${refs.join(" ")}]` : "";
    return `- [${e.severity.toUpperCase()}] ${ts} ${e.type}: ${e.message}${refStr}`;
  });

  const eventSummary = eventLines.length > 0 ? eventLines.join("\n") : "No recent events";

  // ── Workflows ──────────────────────────────────────────────────────────────
  const workflowLines = rawWorkflows.map((w) => {
    const phases = Array.isArray(w.phases) ? w.phases : [];
    const phaseNames = phases.map((p: { name: string }) => p.name).join(" → ");
    const current = w.currentPhase ? ` | current: ${w.currentPhase}` : "";
    const executions = w.executionCount > 0 ? ` | runs: ${w.executionCount}` : "";
    const lastRun = w.lastExecutedAt
      ? ` | last run: ${w.lastExecutedAt.toISOString().slice(0, 10)}`
      : "";
    return `- [${w.status.toUpperCase()}] ${w.name}${current}${executions}${lastRun}${phaseNames ? ` | phases: ${phaseNames}` : ""}`;
  });
  const workflowSummary =
    workflowLines.length > 0 ? workflowLines.join("\n") : "No workflows defined yet";

  const result: ProjectContext = {
    project: projectParts.join(" | "),
    workflows: workflowSummary,
    recentTasks: taskSummary,
    latestMetrics: metricsSummary,
    graphSummary,
    recentEvents: eventSummary,
  };

  // ── Token budget warning ───────────────────────────────────────────────────
  // llama-3.3-70b context window is 128 K tokens (~512 K chars at 4 chars/token).
  // The system prompt alone (built from `result`) uses most of the budget; add
  // the chat history + user message on top. Warn when the context string total
  // exceeds 80 K chars (~20 K tokens) so operators can tune the entity/relation
  // caps before hitting silent model-side truncation.
  const CONTEXT_WARN_CHARS = 80_000;
  const totalChars = Object.values(result).reduce((sum, v) => sum + v.length, 0);
  if (totalChars > CONTEXT_WARN_CHARS) {
    console.warn(
      JSON.stringify({
        scope: "context-builder",
        code: "CONTEXT_SIZE_WARNING",
        projectId,
        totalChars,
        estimatedTokens: Math.round(totalChars / 4),
        threshold: CONTEXT_WARN_CHARS,
        hint: "Consider reducing entity/relationship caps or shortening prompt templates.",
      }),
    );
  }

  // Store in cache — subsequent requests within the TTL window skip the 8
  // parallel DB queries entirely.
  contextCache.set(projectId, { data: result, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
  return result;
}
