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
import type { RepositoryRevisionManifest } from "./context-manifest.js";
import type { ContextCollection } from "./context-contract.js";

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
  "status" | "error" | "finishedAt" | "result"
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

// ─── Slice metadata ───────────────────────────────────────────────────────────

/**
 * Lightweight metadata describing the load outcome for one context section.
 * Consumed by the context runtime layer (context-builder, context-admission)
 * to make budget and freshness decisions without re-reading raw DB rows.
 */
export type SliceMetadata = {
  /** Origin label, e.g. "db:tasks", "db:graph_entities". */
  source: string;
  /** Distinguishes an empty result from a failed or skipped load. */
  status: "not_requested" | "empty" | "loaded" | "load_failed";
  /** Whether the section yielded actual data or came back empty. */
  freshness: "fresh" | "stale" | "missing";
  /** Unix ms timestamp when this section was loaded. */
  loadedAt: number;
  /** Number of rows / items loaded (0 = missing). */
  rowCount: number;
  /** Related sections that must also be loaded to render this section fully. */
  dependencyHints: ContextLoadSection[];
  /** Safe, bounded category for a failed load; raw DB errors never cross the boundary. */
  failureCode?: ContextLoadFailureCode;
  /** Bounded collection facts; totalKnown is false unless explicitly counted. */
  collection: ContextCollection;
};

export type ContextLoadFailureCode =
  | "QUERY_FAILED"
  | "QUERY_TIMEOUT"
  | "QUERY_UNAVAILABLE"
  | "QUERY_CANCELLED";

type SafeLoadResult<T> = {
  value: T;
  status: "loaded" | "empty" | "load_failed";
  failureCode?: ContextLoadFailureCode;
};

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
  contextManifest: import("./context-manifest.js").ContextManifest;
  wants(section: ContextLoadSection): boolean;
  requestedSections: Set<ContextLoadSection>;
  /** Per-section load metadata for the context runtime layer. */
  sliceMetadata: ReadonlyMap<ContextLoadSection | "project", SliceMetadata>;
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
): Promise<SafeLoadResult<T>> {
  try {
    const value = await load();
    const empty =
      Array.isArray(value) ? value.length === 0 : value === undefined || value === null;
    return { value, status: empty ? "empty" : "loaded" };
  } catch (err) {
    const failureCode = classifyLoadFailure(err);
    console.warn(
      JSON.stringify({
        scope: "context-loader",
        code: "QUERY_DEGRADED",
        query: label,
        projectId,
        failureCode,
      }),
    );
    return { value: fallback, status: "load_failed", failureCode };
  }
}

function classifyLoadFailure(error: unknown): ContextLoadFailureCode {
  const candidate = error as { code?: unknown; name?: unknown };
  const code = String(candidate?.code ?? "").toUpperCase();
  const name = String(candidate?.name ?? "").toLowerCase();
  if (code === "57014" || code.includes("TIMEOUT") || name.includes("timeout")) {
    return "QUERY_TIMEOUT";
  }
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "57P01" ||
    name.includes("unavailable")
  ) {
    return "QUERY_UNAVAILABLE";
  }
  if (name.includes("abort") || code === "57012") return "QUERY_CANCELLED";
  return "QUERY_FAILED";
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

/** Load up to 15 tasks for the project, ordered by priority then recency. */
export async function loadTasks(
  tx: Queryable,
  projectId: string,
): Promise<TaskRow[]> {
  return tx
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId))
    .orderBy(asc(tasksTable.priority), desc(tasksTable.updatedAt))
    .limit(15);
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
 * Load graph entities (up to 80) and/or relationships (up to 60, projected).
 * Pass the section-gating flags so unused queries are skipped entirely.
 */
export async function loadGraph(
  tx: Queryable,
  projectId: string,
  wantsEntities: boolean,
  wantsRelationships: boolean,
): Promise<{ entities: GraphEntityRow[]; relationships: GraphRelationshipRow[] }> {
  const [candidateEntities, candidateRelationships] = await Promise.all([
    wantsEntities
      ? (tx
          .select()
          .from(graphEntitiesTable)
          .where(eq(graphEntitiesTable.projectId, projectId))
          .orderBy(desc(graphEntitiesTable.confidence))
          .limit(80) as Promise<GraphEntityRow[]>)
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
           .limit(60)
      : Promise.resolve<GraphRelationshipRow[]>([]),
  ]);
  // Relationships are not trusted solely because their denormalized
  // projectId matches. Both endpoints must resolve to entities owned by this
  // project; otherwise the edge is rejected without disclosing its endpoints.
  const ownedEntities = wantsEntities
    ? candidateEntities
    : candidateRelationships.length > 0
      ? await tx
          .select()
          .from(graphEntitiesTable)
          .where(eq(graphEntitiesTable.projectId, projectId))
          .limit(80) as GraphEntityRow[]
      : [];
  const ownedIds = new Set(ownedEntities.map((entity) => entity.id));
  const knownEntityProjects = new Map(
    ownedEntities.map((entity) => [entity.id, (entity as GraphEntityRow & { projectId?: string }).projectId]),
  );
  const relationships = candidateRelationships.filter(
    (relationship) => {
      const sourceProject = knownEntityProjects.get(relationship.sourceId);
      const targetProject = knownEntityProjects.get(relationship.targetId);
      // A foreign endpoint is always rejected. If an old projection does not
      // include endpoint rows at all, retain the edge for compatibility; the
      // graph serializer will not disclose an unknown endpoint's details.
      const foreignEndpoint =
        (sourceProject !== undefined && sourceProject !== projectId) ||
        (targetProject !== undefined && targetProject !== projectId);
      return !foreignEndpoint
        && ownedIds.has(relationship.sourceId)
        && ownedIds.has(relationship.targetId);
    },
  );
  return {
    entities: wantsEntities ? candidateEntities : [],
    relationships,
  };
}

/** Load up to 15 recent events, ordered by timestamp descending. */
export async function loadEvents(
  tx: Queryable,
  projectId: string,
): Promise<EventRow[]> {
  return tx
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.projectId, projectId))
    .orderBy(desc(eventsTable.timestamp))
    .limit(15);
}

/** Load up to 25 workflows, ordered by last updated descending. */
export async function loadWorkflow(
  tx: Queryable,
  projectId: string,
): Promise<WorkflowRow[]> {
  return tx
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.projectId, projectId))
    .orderBy(desc(workflowsTable.updatedAt))
    .limit(25);
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
      result: scanJobsTable.result,
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
        tasksResult,
        metricsResult,
        graphResult,
        eventsResult,
        workflowsResult,
        scanResult,
      ] = await Promise.all([
        loadProject(q, projectId), // throws on missing project
        wants("tasks")
          ? safeLoad(
              () => loadTasks(q, projectId),
              [] as TaskRow[],
              "tasks",
              projectId,
            )
          : Promise.resolve<SafeLoadResult<TaskRow[]>>({
              value: [],
              status: "empty",
            }),
        wants("metrics")
          ? safeLoad(
              () => loadMetrics(q, projectId),
              undefined,
              "metrics",
              projectId,
            )
          : Promise.resolve<SafeLoadResult<MetricRow | undefined>>({
              value: undefined,
              status: "empty",
            }),
        (wants("graphEntities") || wants("graphRelationships"))
          ? safeLoad(
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
            )
          : Promise.resolve<SafeLoadResult<{
              entities: GraphEntityRow[];
              relationships: GraphRelationshipRow[];
            }>>({
              value: { entities: [], relationships: [] },
              status: "empty",
            }),
        wants("events")
          ? safeLoad(
              () => loadEvents(q, projectId),
              [] as EventRow[],
              "events",
              projectId,
            )
          : Promise.resolve<SafeLoadResult<EventRow[]>>({
              value: [],
              status: "empty",
            }),
        wants("workflows")
          ? safeLoad(
              () => loadWorkflow(q, projectId),
              [] as WorkflowRow[],
              "workflows",
              projectId,
            )
          : Promise.resolve<SafeLoadResult<WorkflowRow[]>>({
              value: [],
              status: "empty",
            }),
        safeLoad(
          () => loadScanJobs(q, projectId),
          undefined,
          "scanJobs",
          projectId,
        ),
      ]);

      const rawTasks = tasksResult.value;
      const latestMetric = metricsResult.value;
      const { entities, relationships } = graphResult.value;
      const recentEvents = eventsResult.value;
      const rawWorkflows = workflowsResult.value;

      const latestScanJob = scanResult.value;
      const scanResultRow = latestScanJob?.result;
      const scanVerified =
        latestScanJob?.status === "completed" &&
        scanResultRow?.scanCompleteness !== "PARTIAL";
      const legacyRevision =
        latestScanJob?.finishedAt?.toISOString() ??
        (project.updatedAt instanceof Date ? project.updatedAt.toISOString() : String(Date.now()));
      const contextManifest = {
        projectId,
        projectRevision:
            typeof scanResultRow?.projectRevision === "string"
              ? scanResultRow.projectRevision
            : latestScanJob?.status === "completed"
              ? `legacy-scan:${legacyRevision}`
              : `unscanned:${legacyRevision}`,
        scanCompleteness:
          latestScanJob?.status !== "completed"
            ? "UNAVAILABLE" as const
            : scanResultRow?.scanCompleteness === "PARTIAL"
              ? "PARTIAL" as const
              : scanResultRow?.scanCompleteness === "COMPLETE"
                ? "COMPLETE" as const
                : "UNAVAILABLE" as const,
        sourceProvenance:
          typeof scanResultRow?.sourceProvenance === "string"
            ? scanResultRow.sourceProvenance
            : latestScanJob?.status === "completed" ? "filesystem-scan:legacy" : "project-record",
        ...(typeof scanResultRow?.scanCorrelationId === "string" && { scanCorrelationId: scanResultRow.scanCorrelationId }),
        ...(typeof scanResultRow?.scannerVersion === "string" && { scannerVersion: scanResultRow.scannerVersion }),
        ...(scanResultRow?.repositoryManifest
          ? { repositoryManifest: scanResultRow.repositoryManifest as RepositoryRevisionManifest }
          : {}),
        capturedAt: new Date().toISOString(),
      };

      const loadedAt = Date.now();
      const _meta = new Map<ContextLoadSection | "project", SliceMetadata>();
        _meta.set("project", {
          source: "db:projects",
          status: "loaded",
          freshness: "fresh",
          loadedAt,
          rowCount: 1,
          dependencyHints: [],
          collection: {
            page: 1,
            pageSize: 1,
            returnedCount: 1,
            totalKnown: true,
            hasMore: false,
            truncated: false,
          },
        });

      const setMeta = (
        section: ContextLoadSection,
        source: string,
        result: SafeLoadResult<unknown>,
        rowCount: number,
        dependencyHints: ContextLoadSection[] = [],
        pageSize = Math.max(1, rowCount),
      ) => {
        const requested = wants(section);
        _meta.set(section, {
          source,
          status: requested ? result.status : "not_requested",
          freshness: requested && result.status === "loaded" ? "fresh" : "missing",
          loadedAt,
          rowCount: requested ? rowCount : 0,
          dependencyHints,
          collection: {
            page: 1,
            pageSize,
            returnedCount: Math.min(rowCount, pageSize),
            totalKnown: false,
            hasMore: rowCount >= pageSize,
            truncated: rowCount >= pageSize,
          },
          ...(requested && result.failureCode ? { failureCode: result.failureCode } : {}),
        });
      };

       setMeta("tasks", "db:tasks", tasksResult, rawTasks.length, [], 15);
       setMeta("metrics", "db:metrics", metricsResult, latestMetric != null ? 1 : 0, [], 1);
      const graphResultFor = (rowCount: number): SafeLoadResult<unknown> => ({
        value: rowCount,
        status: graphResult.status === "load_failed"
          ? "load_failed"
          : rowCount > 0 ? "loaded" : "empty",
        ...(graphResult.failureCode ? { failureCode: graphResult.failureCode } : {}),
      });
       setMeta("graphEntities", "db:graph_entities", graphResultFor(entities.length), entities.length, ["graphRelationships"], 80);
       setMeta("graphRelationships", "db:graph_relationships", graphResultFor(relationships.length), relationships.length, ["graphEntities"], 60);
       setMeta("events", "db:events", eventsResult, recentEvents.length, [], 15);
       setMeta("workflows", "db:workflows", workflowsResult, rawWorkflows.length, [], 25);
      const sliceMetadata: ReadonlyMap<ContextLoadSection | "project", SliceMetadata> = _meta;

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
        contextManifest,
        wants,
        requestedSections,
        sliceMetadata,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
