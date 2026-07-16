/**
 * Context Builder — queries the DB to build rich project context strings
 * that are injected into every agent's system prompt.
 */
import { db } from "@workspace/db";
import {
  projectsTable,
  tasksTable,
  metricsTable,
  graphEntitiesTable,
  eventsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { AgentContext } from "./schemas/context.schema.js";

/** The context object every agent prompt is built from. Shape is enforced at runtime by `AgentContextSchema`. */
export type ProjectContext = AgentContext;

export async function buildProjectContext(projectId: string): Promise<ProjectContext> {
  const [[project], recentTasks, [latestMetric], entities, recentEvents] = await Promise.all([
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)).orderBy(desc(tasksTable.updatedAt)).limit(10),
    db.select().from(metricsTable).where(eq(metricsTable.projectId, projectId)).orderBy(desc(metricsTable.timestamp)).limit(1),
    db.select().from(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId)).limit(60),
    db.select().from(eventsTable).where(eq(eventsTable.projectId, projectId)).orderBy(desc(eventsTable.timestamp)).limit(10),
  ]);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const taskSummary =
    recentTasks.length > 0
      ? recentTasks
          .map(
            (t) =>
              `- [${t.status.toUpperCase()}] ${t.title} (${t.priority})${t.description ? `: ${t.description.slice(0, 80)}` : ""}`,
          )
          .join("\n")
      : "No tasks yet";

  const metricsSummary = latestMetric
    ? `Overall: ${latestMetric.overallScore.toFixed(1)}/100 | Arch: ${latestMetric.architectureScore?.toFixed(1) ?? "N/A"} | Sec: ${latestMetric.securityScore?.toFixed(1) ?? "N/A"} | Perf: ${latestMetric.performanceScore?.toFixed(1) ?? "N/A"} | Reliability: ${latestMetric.reliabilityScore?.toFixed(1) ?? "N/A"}`
    : "No metrics available yet";

  const entityGroups = entities.reduce<Record<string, typeof entities>>((acc, e) => {
    (acc[e.type] ??= []).push(e);
    return acc;
  }, {});

  // Build a rich entity listing: group by type, show name + file path + short description.
  // Capped at 50 total across all types; higher-confidence entities are shown first.
  const shownIds = new Set<string>();
  const entityLines: string[] = [];

  for (const [type, group] of Object.entries(entityGroups)) {
    const members = group
      .filter((e) => !shownIds.has(e.id))
      .slice(0, 20) // max 20 per type so no single type dominates
      .map((e) => {
        shownIds.add(e.id);
        const location = e.path ? ` (${e.path.replace(/^.*[\\/]/, "")})` : "";
        const desc = e.description ? ` — ${e.description.slice(0, 60)}` : "";
        return `  • ${e.name}${location}${desc}`;
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

  const eventSummary =
    recentEvents.length > 0
      ? recentEvents.map((e) => `- [${e.severity}] ${e.type}: ${e.message}`).join("\n")
      : "No recent events";

  return {
    project: `Name: ${project.name} | Language: ${project.language}${project.framework ? ` / ${project.framework}` : ""} | Status: ${project.status} | Quality: ${project.qualityScore?.toFixed(1) ?? "N/A"}/100 | Path: ${project.rootPath}`,
    recentTasks: taskSummary,
    latestMetrics: metricsSummary,
    graphSummary,
    recentEvents: eventSummary,
  };
}
