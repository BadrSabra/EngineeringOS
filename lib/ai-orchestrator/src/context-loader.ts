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
  type Project,
  type Task,
  type MetricRecord,
  type GraphEntity,
  type Event,
  type Workflow,
} from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// ─── Queryable ────────────────────────────────────────────────────────────────
// NodePgDatabase is structurally compatible with both the global db handle and
// the transaction handle Drizzle passes to db.transaction() callbacks.
// Pass either one to domain loaders; use `tx as unknown as Queryable` at the
// transaction boundary since PgTransaction and NodePgDatabase are siblings (not
// parent/child) in Drizzle's class hierarchy.
type Queryable = NodePgDatabase<Record<string, unknown>>;

// ─── Full-row type aliases ────────────────────────────────────────────────────
// Re-exported under context-meaningful names; consumers import from here, not
// from @workspace/db directly, so the context layer owns the boundary.
export type ProjectRow = Project;
export type TaskRow = Task;
export type MetricRow = MetricRecord;
export type GraphEntityRow = GraphEntity;
export type EventRow = Event;
export type WorkflowRow = Workflow;

// ─── Projection DTOs ──────────────────────────────────────────────────────────
// These narrow the full $inferSelect types to the columns we actually SELECT
// in the query, keeping DTO shapes honest about what the DB returns.

/** Projected subset of scan_jobs fetched by loadScanJobs(). */
export type ScanJobRow = Pick<
  typeof scanJobsTable.$inferSelect,
  "status" | "error" | "finishedAt"
>;

/** Projected subset of graph_relationships fetched by loadGraph(). */
export type GraphRelationshipRow = Pick<
  typeof graphRelationshipsTable.$inferSelect,
  | "id"
  | "sourceId"
  | "targetId"
  | "relation"
  | "relationType"
  | "confidence"
  | "isHeuristic"
>;

// ─── Section gating ───────────────────────────────────────────────────────────

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

// ─── LoadedProjectContext ─────────────────────────────────────────────────────
// Zero `any` fields — every field maps to an explicit typed DTO.

export type LoadedProjectContext = {
  project: ProjectRow;
  rawTasks: TaskRow[];
  latestMetric: MetricRow | undefined;
  entities: GraphEntityRow[];
  relationships: GraphRelationshipRow[];
  recentEvents: EventRow[];
  rawWorkflows: WorkflowRow[];
  latestScanJob: ScanJobRow | undefined;
  scanVerified: boolean;
  wants(section: ContextLoadSection): boolean;
  requestedSections: Set<ContextLoadSection>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_CONTEXT_SECTIONS: readonly ContextLoadSection[] = [
  "tasks",
  "metrics",
  "graphEntities",
  "graphRelationships",
  "events",
  "workflows",
];

function resolveContextSections(
  sections?: ContextLoadSection[],
): Set<ContextLoadSection> {
  return new Set(
    sections && sections.length > 0 ? sections : ALL_CONTEXT_SECTIONS,
  );
}

/**
 * Wraps a domain load with graceful degradation: if the query fails, log a
 * warning and return the provided fallback rather than aborting the whole
 * context build.  The project row is NOT wrapped — its failure throws.
 */
async function safeLoad<T>(
  load: () => Promise<T>,
  fallback: T,
  label: string,
  projectId: string,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "context-loader",
        code: "QUERY_DEGRADED",
        query: label,
        projectId,
        error: String(err),
      }),
    );
    return fallback;
  }
}

// ─── Domain loaders ───────────────────────────────────────────────────────────
// Each loader is independently exported so it can be unit-tested without
// going through the full loadProjectContext() orchestrator.

/** Load the project row. Throws if the project does not exist. */
export async function loadProject(
  tx: Queryable,
  projectId: string,
): Promise<ProjectRow> {
  const rows = await tx
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  const project = rows[0];
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project;
}

/** Load up to 10 tasks for the project, ordered by priority then recency. */
export async function loadTasks(
  tx: Queryable,
  projectId: string,
): Promise<TaskRow[]> {
  return tx
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId))
    .orderBy(asc(tasksTable.priority), desc(tasksTable.updatedAt))
    .limit(10);
}

/** Load the single most recent metric snapshot, or undefined if none exists. */
export async function loadMetrics(
  tx: Queryable,
  projectId: string,
): Promise<MetricRow | undefined> {
  const rows = await tx
    .select()
    .from(metricsTable)
    .where(eq(metricsTable.projectId, projectId))
    .orderBy(desc(metricsTable.timestamp))
    .limit(1);
  return rows[0];
}

/**
 * Load graph entities (up to 60) and/or relationships (up to 40, projected).
 * Pass the section-gating flags so unused queries are skipped entirely.
 */
export async function loadGraph(
  tx: Queryable,
  projectId: string,
  wantsEntities: boolean,
  wantsRelationships: boolean,
): Promise<{ entities: GraphEntityRow[]; relationships: GraphRelationshipRow[] }> {
  const [entities, relationships] = await Promise.all([
    wantsEntities
      ? (tx
          .select()
          .from(graphEntitiesTable)
          .where(eq(graphEntitiesTable.projectId, projectId))
          .orderBy(desc(graphEntitiesTable.confidence))
          .limit(60) as Promise<GraphEntityRow[]>)
      : Promise.resolve<GraphEntityRow[]>([]),
    wantsRelationships
      ? tx
          .select({
            id: graphRelationshipsTable.id,
            sourceId: graphRelationshipsTable.sourceId,
            targetId: graphRelationshipsTable.targetId,
            relation: graphRelationshipsTable.relation,
            relationType: graphRelationshipsTable.relationType,
            confidence: graphRelationshipsTable.confidence,
            isHeuristic: graphRelationshipsTable.isHeuristic,
          })
          .from(graphRelationshipsTable)
          .where(eq(graphRelationshipsTable.projectId, projectId))
          .orderBy(desc(graphRelationshipsTable.confidence))
          .limit(40)
      : Promise.resolve<GraphRelationshipRow[]>([]),
  ]);
  return { entities, relationships };
}

/** Load up to 10 recent events, ordered by timestamp descending. */
export async function loadEvents(
  tx: Queryable,
  projectId: string,
): Promise<EventRow[]> {
  return tx
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.projectId, projectId))
    .orderBy(desc(eventsTable.timestamp))
    .limit(10);
}

/** Load up to 20 workflows, ordered by last updated descending. */
export async function loadWorkflow(
  tx: Queryable,
  projectId: string,
): Promise<WorkflowRow[]> {
  return tx
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.projectId, projectId))
    .orderBy(desc(workflowsTable.updatedAt))
    .limit(20);
}

/**
 * Load the most recent scan job (status/error/finishedAt only), or undefined.
 * Always fetched regardless of section gating — used for scan-verification.
 */
export async function loadScanJobs(
  tx: Queryable,
  projectId: string,
): Promise<ScanJobRow | undefined> {
  const rows = await tx
    .select({
      status: scanJobsTable.status,
      error: scanJobsTable.error,
      finishedAt: scanJobsTable.finishedAt,
    })
    .from(scanJobsTable)
    .where(eq(scanJobsTable.projectId, projectId))
    .orderBy(desc(scanJobsTable.createdAt))
    .limit(1);
  return rows[0];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Load all requested context sections for a project inside a single
 * REPEATABLE READ transaction so every query sees the same DB snapshot.
 *
 * Non-critical domain failures are degraded (warn + empty default) rather
 * than aborting the whole build.  Project row failure always throws.
 */
export async function loadProjectContext(
  projectId: string,
  options: BuildProjectContextOptions = {},
): Promise<LoadedProjectContext> {
  const requestedSections = resolveContextSections(options.sections);
  const wants = (section: ContextLoadSection): boolean =>
    requestedSections.has(section);

  return db.transaction(
    async (tx) => {
      // Cast is required because PgTransaction and NodePgDatabase are siblings
      // in Drizzle's class hierarchy — both expose the same query interface.
      const q = tx as unknown as Queryable;

      const [
        project,
        rawTasks,
        latestMetric,
        { entities, relationships },
        recentEvents,
        rawWorkflows,
        latestScanJob,
      ] = await Promise.all([
        loadProject(q, projectId), // throws on missing project
        wants("tasks")
          ? safeLoad(
              () => loadTasks(q, projectId),
              [] as TaskRow[],
              "tasks",
              projectId,
            )
          : Promise.resolve([] as TaskRow[]),
        wants("metrics")
          ? safeLoad(
              () => loadMetrics(q, projectId),
              undefined,
              "metrics",
              projectId,
            )
          : Promise.resolve(undefined as MetricRow | undefined),
        safeLoad(
          () =>
            loadGraph(
              q,
              projectId,
              wants("graphEntities"),
              wants("graphRelationships"),
            ),
          { entities: [] as GraphEntityRow[], relationships: [] as GraphRelationshipRow[] },
          "graph",
          projectId,
        ),
        wants("events")
          ? safeLoad(
              () => loadEvents(q, projectId),
              [] as EventRow[],
              "events",
              projectId,
            )
          : Promise.resolve([] as EventRow[]),
        wants("workflows")
          ? safeLoad(
              () => loadWorkflow(q, projectId),
              [] as WorkflowRow[],
              "workflows",
              projectId,
            )
          : Promise.resolve([] as WorkflowRow[]),
        safeLoad(
          () => loadScanJobs(q, projectId),
          undefined,
          "scanJobs",
          projectId,
        ),
      ]);

      const scanVerified = latestScanJob?.status === "completed";

      return {
        project,
        rawTasks,
        latestMetric,
        entities,
        relationships,
        recentEvents,
        rawWorkflows,
        latestScanJob,
        scanVerified,
        wants,
        requestedSections,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
