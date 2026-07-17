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
  eventsTable,
  workflowsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { AgentContext } from "./schemas/context.schema.js";

/** The context object every agent prompt is built from. Shape is enforced at runtime by `AgentContextSchema`. */
export type ProjectContext = AgentContext;

// Priority rank map: lower number = higher urgency (P0 is most urgent).
const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

export async function buildProjectContext(projectId: string): Promise<ProjectContext> {
  const [[project], rawTasks, [latestMetric], entities, recentEvents, rawWorkflows] = await Promise.all([
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    // Fetch more rows than we display so the client-side priority sort can
    // surface urgent tasks even if they were updated less recently.
    db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)).orderBy(desc(tasksTable.updatedAt)).limit(50),
    db.select().from(metricsTable).where(eq(metricsTable.projectId, projectId)).orderBy(desc(metricsTable.timestamp)).limit(1),
    // Order by confidence DESC so the most certain entities fill the cap first.
    db.select().from(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId)).orderBy(desc(graphEntitiesTable.confidence)).limit(60),
    db.select().from(eventsTable).where(eq(eventsTable.projectId, projectId)).orderBy(desc(eventsTable.timestamp)).limit(10),
    db.select().from(workflowsTable).where(eq(workflowsTable.projectId, projectId)).orderBy(desc(workflowsTable.updatedAt)).limit(20),
  ]);

  if (!project) throw new Error(`Project ${projectId} not found`);

  // ── Project ────────────────────────────────────────────────────────────────
  const lastScan = project.lastScanAt
    ? project.lastScanAt.toISOString().slice(0, 10)
    : "never";
  const projectParts: string[] = [
    `Name: ${project.name}`,
    `Language: ${project.language}${project.framework ? ` / ${project.framework}` : ""}`,
    `Status: ${project.status}`,
    `Quality: ${project.qualityScore?.toFixed(1) ?? "N/A"}/100`,
    `Path: ${project.rootPath}`,
    `Last scan: ${lastScan}`,
  ];
  // Include description only when present — it is often empty on new projects.
  if (project.description) projectParts.push(`Description: ${project.description}`);

  // ── Tasks ──────────────────────────────────────────────────────────────────
  // Sort: primary = priority (P0 first), secondary = recency (updatedAt DESC).
  // This surfaces urgent tasks that haven't been touched recently above
  // low-priority tasks that were just updated.
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
    metricsSummary = parts.join(" | ");
  } else {
    metricsSummary = "No metrics available yet";
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

  const graphSummary =
    entities.length > 0
      ? `${entities.length} entities total:\n${entityLines.join("\n")}`
      : "Knowledge graph empty — run a scan first";

  // ── Events ────────────────────────────────────────────────────────────────
  // Arrive ordered by timestamp DESC (most recent first).
  // Timestamp is now included so agents can reason about staleness.
  const eventLines = recentEvents.map((e) => {
    const ts = e.timestamp.toISOString().slice(0, 16).replace("T", " ");
    return `- [${e.severity.toUpperCase()}] ${ts} ${e.type}: ${e.message}`;
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

  return {
    project: projectParts.join(" | "),
    workflows: workflowSummary,
    recentTasks: taskSummary,
    latestMetrics: metricsSummary,
    graphSummary,
    recentEvents: eventSummary,
  };
}
