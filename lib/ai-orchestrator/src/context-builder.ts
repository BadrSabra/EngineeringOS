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

// ── Cross-process invalidation hook ──────────────────────────────────────────
// Registered once at server startup via setInvalidationNotifier().
// Defaults to a no-op so library-only consumers (tests, other services) work
// without a live DB connection.
let _invalidationNotifier: ((projectId: string) => void) | null = null;

/**
 * Register a cross-process cache invalidation notifier.
 *
 * The provided `fn` is called fire-and-forget after every local cache eviction.
 * It should issue a `SELECT pg_notify('ctx_invalid', projectId)` on the shared
 * pool so all listening server processes immediately evict their local copies.
 *
 * Errors thrown by `fn` are swallowed — a broken NOTIFY path must never
 * propagate into the synchronous `invalidateContextCache` callers.
 *
 * Call once at server startup, after the DB pool is ready.
 */
export function setInvalidationNotifier(fn: (projectId: string) => void): void {
  _invalidationNotifier = fn;
}

// ── Minimal pool interface for startContextInvalidationChannel ────────────────
// Uses a structural interface so callers can pass a pg.Pool without this
// library needing a direct `pg` dependency.

interface NotifyPoolClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  on(event: "notification", listener: (msg: { channel: string; payload?: string }) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "end", listener: () => void): this;
  release(): void;
  removeAllListeners(): this;
}

interface NotifyPool {
  connect(): Promise<NotifyPoolClient>;
}

/**
 * Start a dedicated PostgreSQL LISTEN connection for cross-process cache
 * invalidation. When any server process calls
 * `SELECT pg_notify('ctx_invalid', projectId)`, every process with an active
 * channel immediately evicts that project from its local in-process cache.
 *
 * The function acquires ONE dedicated client from the pool (held outside the
 * pool's rotation) so LISTEN semantics are not disrupted by pool reuse.
 *
 * If the connection drops (DB restart, network blip), it logs a warning and
 * schedules a reconnect after 5 seconds. During the gap, the 30-second TTL
 * acts as the last-resort safety net — no data loss, just a brief staleness
 * window.
 *
 * Returns a `stop()` handle to release the client on graceful shutdown.
 */
export function startContextInvalidationChannel(pool: NotifyPool): { stop: () => void } {
  let client: NotifyPoolClient | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect(): Promise<void> {
    if (stopped) return;
    // Clear any pending reconnect timer — we are now connecting.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    let acquired: NotifyPoolClient | null = null;
    try {
      acquired = await pool.connect();
      // If LISTEN fails (e.g. DB permission error), we must release the
      // acquired client before scheduling a reconnect — not doing so leaks
      // a pool connection per failed setup attempt.
      await acquired.query("LISTEN ctx_invalid");

      // LISTEN succeeded — commit the client reference and attach listeners.
      client = acquired;
      acquired = null; // ownership transferred to `client`

      client.on("notification", (msg) => {
        if (msg.channel === "ctx_invalid" && msg.payload) {
          // Evict locally only — do NOT call invalidateContextCache() to avoid
          // re-triggering the notifier and creating a cross-process loop.
          contextCache.delete(msg.payload);
        }
      });

      // Both "error" and "end" can fire for the same disconnect event.
      // Each calls disconnect() which is idempotent, and scheduleReconnect()
      // which guards against duplicate timers — only one reconnect is queued.
      client.on("error", (err) => {
        console.warn(
          JSON.stringify({
            scope: "ctx-cache-channel",
            code: "LISTEN_ERROR",
            error: String(err),
          }),
        );
        disconnect();
      });

      client.on("end", () => {
        if (!stopped) {
          console.warn(
            JSON.stringify({ scope: "ctx-cache-channel", code: "LISTEN_ENDED" }),
          );
          disconnect();
        }
      });

      console.info(
        JSON.stringify({
          scope: "ctx-cache-channel",
          code: "LISTEN_READY",
          channel: "ctx_invalid",
        }),
      );
    } catch (err) {
      // Release any client that was acquired but not yet committed to `client`.
      if (acquired) {
        try { acquired.removeAllListeners(); } catch { /* ignore */ }
        try { acquired.release(); } catch { /* ignore */ }
        acquired = null;
      }
      console.warn(
        JSON.stringify({
          scope: "ctx-cache-channel",
          code: "CONNECT_FAILED",
          error: String(err),
        }),
      );
      scheduleReconnect();
    }
  }

  /** Release the active client and schedule a reconnect. Idempotent. */
  function disconnect(): void {
    releaseClient();
    scheduleReconnect();
  }

  function releaseClient(): void {
    if (client) {
      client.removeAllListeners();
      client.release();
      client = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    // Guard: if a timer is already pending, do not queue another one.
    // This prevents the "error" + "end" double-fire from creating two
    // concurrent reconnect attempts that each acquire a dedicated client.
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, 5_000);
  }

  void connect();

  return {
    stop(): void {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      releaseClient();
    },
  };
}

/**
 * Invalidate the cached context for a project immediately.
 * Call after any write that changes context-relevant data — e.g. applying AI
 * file changes, completing a scan, or updating a task.
 */
export function invalidateContextCache(projectId: string): void {
  contextCache.delete(projectId);
  // Fire-and-forget cross-process NOTIFY — errors are swallowed so a broken
  // NOTIFY path never propagates to the (synchronous) call site.
  if (_invalidationNotifier) {
    try { _invalidationNotifier(projectId); } catch { /* swallowed — degrades to TTL */ }
  }
}

export async function buildProjectContext(projectId: string): Promise<ProjectContext> {
  // Return cached context when it is still fresh.
  const now = Date.now();
  const cached = contextCache.get(projectId);
  if (cached && cached.expiresAt > now) return cached.data;
  // PR-04 / G-12: wrap all 8 reads in a single REPEATABLE READ transaction so
  // every query sees the same committed DB snapshot.  Without this, a concurrent
  // write (e.g. a scan completing between the metrics query and the entities
  // query) can produce an internally-inconsistent context where one half reflects
  // post-write state and the other half reflects pre-write state.
  //
  // Promise.allSettled is retained inside the transaction so a single flaky
  // query still degrades gracefully rather than rolling back the whole read and
  // serving a 500.  The project row remains a hard failure — all others degrade
  // to empty arrays with a logged warning.
  const [
    projectResult, tasksResult, metricsResult, entitiesResult,
    eventsResult, workflowsResult, scanJobResult, relationshipsResult,
  ] = await db.transaction(async (tx) => {
    return Promise.allSettled([
      tx.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
      // Sort in the DB by priority ASC (p0 < p1 < p2 < p3 lexically), then by
      // recency DESC as a tiebreaker.  This ensures a P0 task that hasn't been
      // touched in weeks is never cut before lower-priority recently-updated tasks.
      tx.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)).orderBy(asc(tasksTable.priority), desc(tasksTable.updatedAt)).limit(10),
      tx.select().from(metricsTable).where(eq(metricsTable.projectId, projectId)).orderBy(desc(metricsTable.timestamp)).limit(1),
      // Order by confidence DESC so the most certain entities fill the cap first.
      tx.select().from(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId)).orderBy(desc(graphEntitiesTable.confidence)).limit(60),
      tx.select().from(eventsTable).where(eq(eventsTable.projectId, projectId)).orderBy(desc(eventsTable.timestamp)).limit(10),
      tx.select().from(workflowsTable).where(eq(workflowsTable.projectId, projectId)).orderBy(desc(workflowsTable.updatedAt)).limit(20),
      // Fetch scan job to distinguish real scans from import-time defaults.
      tx.select({ status: scanJobsTable.status, error: scanJobsTable.error, finishedAt: scanJobsTable.finishedAt })
        .from(scanJobsTable).where(eq(scanJobsTable.projectId, projectId)).orderBy(desc(scanJobsTable.createdAt)).limit(1),
      // Gap-1 fix: load relationships so the AI sees graph topology (edges), not
      // just entity nodes. Capped at 40 high-confidence edges.
      tx.select({
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
  }, { isolationLevel: "repeatable read" });

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
    if (latestMetric.structuralTestEstimate != null) {
      parts.push(`StructuralTestEstimate: ${fmt(latestMetric.structuralTestEstimate)}% (heuristic — not measured coverage)`);
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
