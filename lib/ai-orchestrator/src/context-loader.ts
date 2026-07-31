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

export type ContextLoadSection =
  | "tasks"
  | "metrics"
  | "graphEntities"
  | "graphRelationships"
  | "events"
  | "workflows";

export type BuildProjectContextOptions = {
  sections?: ContextLoadSection[];
};

export type LoadedProjectContext = {
  project: any;
  rawTasks: any[];
  latestMetric: any | undefined;
  entities: any[];
  recentEvents: any[];
  rawWorkflows: any[];
  latestScanJob: any | undefined;
  relationships: any[];
  scanVerified: boolean;
  wants(section: ContextLoadSection): boolean;
  requestedSections: Set<ContextLoadSection>;
};

const ALL_CONTEXT_SECTIONS: readonly ContextLoadSection[] = [
  "tasks",
  "metrics",
  "graphEntities",
  "graphRelationships",
  "events",
  "workflows",
];

function resolveContextSections(sections?: ContextLoadSection[]): Set<ContextLoadSection> {
  return new Set(sections && sections.length > 0 ? sections : ALL_CONTEXT_SECTIONS);
}

export async function loadProjectContext(
  projectId: string,
  options: BuildProjectContextOptions = {},
): Promise<LoadedProjectContext> {
  const requestedSections = resolveContextSections(options.sections);
  const wants = (section: ContextLoadSection): boolean => requestedSections.has(section);

  // PR-04 / G-12: wrap all reads in a single REPEATABLE READ transaction so
  // every query sees the same committed DB snapshot. Build the query builders
  // inside the transaction so they are executed by the tx handle, not the
  // global db handle.
  const { queryEntries, settledResults } = await db.transaction(async (tx) => {
    const entries: Array<{ key: string; promise: Promise<unknown> }> = [];
    entries.push({
      key: "project",
      promise: tx.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    });

    if (wants("tasks")) {
      entries.push({
        key: "tasks",
        promise: tx.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)).orderBy(asc(tasksTable.priority), desc(tasksTable.updatedAt)).limit(10),
      });
    }

    if (wants("metrics")) {
      entries.push({
        key: "metrics",
        promise: tx.select().from(metricsTable).where(eq(metricsTable.projectId, projectId)).orderBy(desc(metricsTable.timestamp)).limit(1),
      });
    }

    if (wants("graphEntities")) {
      entries.push({
        key: "graphEntities",
        promise: tx.select().from(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId)).orderBy(desc(graphEntitiesTable.confidence)).limit(60),
      });
    }

    if (wants("events")) {
      entries.push({
        key: "events",
        promise: tx.select().from(eventsTable).where(eq(eventsTable.projectId, projectId)).orderBy(desc(eventsTable.timestamp)).limit(10),
      });
    }

    if (wants("workflows")) {
      entries.push({
        key: "workflows",
        promise: tx.select().from(workflowsTable).where(eq(workflowsTable.projectId, projectId)).orderBy(desc(workflowsTable.updatedAt)).limit(20),
      });
    }

    entries.push({
      key: "scanJobs",
      promise: tx.select({ status: scanJobsTable.status, error: scanJobsTable.error, finishedAt: scanJobsTable.finishedAt })
        .from(scanJobsTable).where(eq(scanJobsTable.projectId, projectId)).orderBy(desc(scanJobsTable.createdAt)).limit(1),
    });

    if (wants("graphRelationships")) {
      entries.push({
        key: "graphRelationships",
        promise: tx.select({
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
      });
    }

    const results = await Promise.allSettled(entries.map((entry) => entry.promise));
    return { queryEntries: entries, settledResults: results };
  }, { isolationLevel: "repeatable read" });

  const resultByKey = new Map<string, PromiseSettledResult<unknown>>();
  queryEntries.forEach((entry, index) => {
    resultByKey.set(entry.key, settledResults[index] as PromiseSettledResult<unknown>);
  });

  const projectResult = resultByKey.get("project") as PromiseSettledResult<any[]>;
  const tasksResult = (resultByKey.get("tasks") ?? { status: "fulfilled", value: [] as never[] }) as PromiseSettledResult<any[]>;
  const metricsResult = (resultByKey.get("metrics") ?? { status: "fulfilled", value: [] as never[] }) as PromiseSettledResult<any[]>;
  const entitiesResult = (resultByKey.get("graphEntities") ?? { status: "fulfilled", value: [] as never[] }) as PromiseSettledResult<any[]>;
  const eventsResult = (resultByKey.get("events") ?? { status: "fulfilled", value: [] as never[] }) as PromiseSettledResult<any[]>;
  const workflowsResult = (resultByKey.get("workflows") ?? { status: "fulfilled", value: [] as never[] }) as PromiseSettledResult<any[]>;
  const scanJobResult = (resultByKey.get("scanJobs") ?? { status: "fulfilled", value: [] as never[] }) as PromiseSettledResult<any[]>;
  const relationshipsResult = (resultByKey.get("graphRelationships") ?? { status: "fulfilled", value: [] as never[] }) as PromiseSettledResult<any[]>;

  function settled<T>(result: PromiseSettledResult<T[]>, label: string): T[] {
    if (result.status === "fulfilled") return result.value;
    console.warn(JSON.stringify({ scope: "context-loader", code: "QUERY_DEGRADED", query: label, projectId, error: String(result.reason) }));
    return [];
  }

  if (projectResult.status === "rejected") {
    console.error(JSON.stringify({ scope: "context-loader", code: "PROJECT_QUERY_FAILED", projectId, error: String(projectResult.reason) }));
    throw new Error(`Failed to load project ${projectId}: ${projectResult.reason}`);
  }

  const [project] = projectResult.value as any[];
  if (!project) throw new Error(`Project ${projectId} not found`);

  const rawTasks = wants("tasks") ? (settled(tasksResult, "tasks") as any[]) : [];
  const [latestMetric] = wants("metrics") ? (settled(metricsResult, "metrics") as any[]) : [];
  const entities = wants("graphEntities") ? (settled(entitiesResult, "graphEntities") as any[]) : [];
  const recentEvents = wants("events") ? (settled(eventsResult, "events") as any[]) : [];
  const rawWorkflows = wants("workflows") ? (settled(workflowsResult, "workflows") as any[]) : [];
  const [latestScanJob] = settled(scanJobResult, "scanJobs") as any[];
  const relationships = wants("graphRelationships") ? (settled(relationshipsResult, "graphRelationships") as any[]) : [];

  const scanVerified = latestScanJob?.status === "completed";

  return {
    project,
    rawTasks,
    latestMetric,
    entities,
    recentEvents,
    rawWorkflows,
    latestScanJob,
    relationships,
    scanVerified,
    wants,
    requestedSections,
  };
}
