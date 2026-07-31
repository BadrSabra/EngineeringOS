import type { AgentContext as ProjectContext } from "./schemas/context.schema.js";
import type { LoadedProjectContext } from "./context-loader.js";

function buildMissingSummary(section: string): string {
  return `${section} not loaded — request it through buildProjectContext({ sections: [...] })`;
}

// Priority rank map: lower number = higher urgency (P0 is most urgent).
const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

function buildScanLabel(loaded: LoadedProjectContext): string {
  const { latestScanJob, scanVerified } = loaded;
  const scanFailed = latestScanJob?.status === "failed";
  const scanPending = latestScanJob?.status === "queued" || latestScanJob?.status === "running";
  return scanVerified
    ? "completed"
    : scanFailed
      ? `FAILED (${latestScanJob?.error?.slice(0, 80) ?? "unknown error"})`
      : scanPending
        ? String(latestScanJob?.status ?? "pending")
        : "never run";
}

function buildProjectSummary(loaded: LoadedProjectContext): string {
  const { project, scanVerified } = loaded;
  const lastScan = project.lastScanAt ? project.lastScanAt.toISOString().slice(0, 10) : "never";
  const qualityNote = scanVerified
    ? project.qualityScore?.toFixed(1) ?? "N/A"
    : `${project.qualityScore?.toFixed(1) ?? "N/A"} ⚠ unverified`;

  const parts: string[] = [
    `Name: ${project.name}`,
    `Language: ${project.language}${project.framework ? ` / ${project.framework}` : ""}`,
    `Status: ${project.status}`,
    `Quality: ${qualityNote}/100`,
    `Path: ${project.rootPath}`,
    `Last scan: ${lastScan} [${buildScanLabel(loaded)}]`,
  ];

  if (project.description) parts.push(`Description: ${project.description}`);

  if (project.gitRemoteUrl) {
    const branch = project.gitDefaultBranch ?? "main";
    parts.push(`Git remote: ${project.gitRemoteUrl} (branch: ${branch})`);
  } else {
    parts.push(`Git remote: not configured — user can add one in the GitHub panel`);
  }

  return parts.join(" | ");
}

function buildTaskSummary(loaded: LoadedProjectContext): string {
  const { rawTasks, wants } = loaded;
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

  return wants("tasks")
    ? (taskLines.length > 0 ? taskLines.join("\n") : "No tasks yet")
    : buildMissingSummary("Tasks");
}

function buildMetricsSummary(loaded: LoadedProjectContext): string {
  const { latestMetric, scanVerified, wants } = loaded;
  if (!wants("metrics")) {
    return buildMissingSummary("Metrics");
  }

  if (!latestMetric) {
    return "No metrics available yet — a scan has not been run for this project.";
  }

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

  return scanVerified
    ? rawMetrics
    : `${rawMetrics}\n⚠ WARNING: These metrics were NOT produced by a successful scan. They are placeholder values set at import time and do NOT reflect real code analysis. Do NOT present them to the user as actual quality measurements. Tell the user to run a scan first.`;
}

function buildGraphSummary(loaded: LoadedProjectContext): string {
  const { entities, relationships, wants } = loaded;
  if (!wants("graphEntities") && !wants("graphRelationships")) {
    return buildMissingSummary("Knowledge graph");
  }

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
        const kind = e.kind ? ` <${e.kind}>` : "";
        const conf = e.confidence != null ? ` [${(e.confidence * 100).toFixed(0)}%]` : "";
        const domain = e.domain ? ` {${e.domain}}` : "";
        const desc = e.description ? ` — ${e.description.slice(0, 60)}` : "";
        return `  • ${e.name}${kind}${file}${conf}${domain}${desc}`;
      });

    if (members.length > 0) {
      entityLines.push(`${type} (${group.length}):\n${members.join("\n")}`);
    }
    if (shownIds.size >= 50) break;
  }

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
  const relSummary = relLines.length > 0 ? `\nRelationships (${relationships.length} shown):\n${relLines.join("\n")}` : "";

  let provenanceHeader = "";
  if (entities.length > 0) {
    const sourceTypeCounts: Record<string, number> = {};
    const confidenceBuckets: Record<string, number> = { high: 0, medium: 0, low: 0 };
    for (const e of entities) {
      const st = (e.sourceType as string | null) ?? "unknown";
      sourceTypeCounts[st] = (sourceTypeCounts[st] ?? 0) + 1;
      const conf = (e.confidence as number | null) ?? 0;
      if (conf >= 0.8) confidenceBuckets.high++;
      else if (conf >= 0.5) confidenceBuckets.medium++;
      else confidenceBuckets.low++;
    }
    const provParts = Object.entries(sourceTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(" | ");
    const confParts = Object.entries(confidenceBuckets)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${v}`)
      .join(" | ");
    provenanceHeader = `Provenance: ${provParts}\nConfidence: ${confParts}\n`;
  }

  return entities.length > 0
    ? `${provenanceHeader}${entities.length} entities total:\n${entityLines.join("\n")}${relSummary}`
    : "Knowledge graph empty — run a scan first";
}

function buildEventSummary(loaded: LoadedProjectContext): string {
  const { recentEvents, wants } = loaded;
  const eventLines = recentEvents.map((e) => {
    const ts = e.timestamp.toISOString().slice(0, 16).replace("T", " ");
    const refs: string[] = [];
    if (e.taskId) refs.push(`task:${e.taskId.slice(0, 8)}`);
    if (e.workflowId) refs.push(`wf:${e.workflowId.slice(0, 8)}`);
    if (e.correlationId) refs.push(`corr:${e.correlationId.slice(0, 8)}`);
    const refStr = refs.length > 0 ? ` [${refs.join(" ")}]` : "";
    return `- [${e.severity.toUpperCase()}] ${ts} ${e.type}: ${e.message}${refStr}`;
  });

  return wants("events")
    ? (eventLines.length > 0 ? eventLines.join("\n") : "No recent events")
    : buildMissingSummary("Recent events");
}

function buildWorkflowSummary(loaded: LoadedProjectContext): string {
  const { rawWorkflows, wants } = loaded;
  const workflowLines = rawWorkflows.map((w) => {
    const phases = Array.isArray(w.phases) ? w.phases : [];
    const phaseNames = phases.map((p: { name: string }) => p.name).join(" → ");
    const current = w.currentPhase ? ` | current: ${w.currentPhase}` : "";
    const executions = w.executionCount > 0 ? ` | runs: ${w.executionCount}` : "";
    const lastRun = w.lastExecutedAt ? ` | last run: ${w.lastExecutedAt.toISOString().slice(0, 10)}` : "";
    return `- [${w.status.toUpperCase()}] ${w.name}${current}${executions}${lastRun}${phaseNames ? ` | phases: ${phaseNames}` : ""}`;
  });

  return wants("workflows")
    ? (workflowLines.length > 0 ? workflowLines.join("\n") : "No workflows defined yet")
    : buildMissingSummary("Workflows");
}

export function buildProjectContextFromLoadedContext(loaded: LoadedProjectContext): ProjectContext {
  return {
    project: buildProjectSummary(loaded),
    workflows: buildWorkflowSummary(loaded),
    recentTasks: buildTaskSummary(loaded),
    latestMetrics: buildMetricsSummary(loaded),
    graphSummary: buildGraphSummary(loaded),
    recentEvents: buildEventSummary(loaded),
    metricsVerified: loaded.scanVerified,
  };
}
