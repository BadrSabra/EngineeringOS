import { pgTable, text, timestamp, integer, jsonb, pgEnum, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects.js";

// Session-level status (the discoverySessionsTable.status column below).
// Distinct from DiscoveryStep["status"], which tracks each individual
// pipeline step (pending/running/done/error) inside the `steps` jsonb array.
export const discoverySessionStatusEnum = pgEnum("discovery_session_status", [
  "pending",
  "discovering",
  "ready",
  "error",
  "imported",
]);

/**
 * Source types for project discovery.
 * Each type corresponds to a SourceAdapter implementation in the API server.
 *
 * LOCAL_FOLDER      — scan a directory already on the server filesystem
 * WORKSPACE_PROJECT — scan an existing registered project's rootPath
 * GIT_REPOSITORY    — clone a remote Git repo, then scan the clone
 * ARCHIVE_UPLOAD    — unpack a previously uploaded .zip/.tar.gz, then scan
 * REMOTE_FILESYSTEM — mount/access a remote path (future)
 * DOCKER_VOLUME     — access a Docker volume (future)
 */
export const sourceTypeEnum = pgEnum("source_type", [
  "LOCAL_FOLDER",
  "WORKSPACE_PROJECT",
  "GIT_REPOSITORY",
  "ARCHIVE_UPLOAD",
  "REMOTE_FILESYSTEM",
  "DOCKER_VOLUME",
]);

export type SourceType = (typeof sourceTypeEnum.enumValues)[number];

export interface DiscoverySourceConfig {
  // LOCAL_FOLDER
  path?: string;
  // GIT_REPOSITORY
  url?: string;
  branch?: string;
  credentials?: { username: string; token: string };
  // ARCHIVE_UPLOAD
  uploadId?: string;
  // WORKSPACE_PROJECT
  projectId?: string;
}

export interface DiscoveryOptions {
  skipRules?: boolean;
  skipGraph?: boolean;
  maxDepth?: number;
  includeTests?: boolean;
}

export interface DiscoveryStep {
  name: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
}

export interface DiscoveryRuleViolation {
  code: string;
  title: string;
  severity: string;
  count: number;
}

export interface DiscoveryGraphSummary {
  entityCount: number;
  relationshipCount: number;
  /** Entity count broken down by type, e.g. `{ function: 120, class: 30 }`. */
  entitiesByType: Record<string, number>;
  /** Scanned source-file count broken down by detected language. */
  filesByLanguage: Record<string, number>;
}

export interface DiscoveryResultData {
  detectedName: string;
  detectedLanguage: string;
  detectedLanguages: string[];
  detectedFramework: string | null;
  detectedRuntime: string | null;
  detectedPackageManager: string | null;
  detectedArchitecture: string | null;
  detectedDb: string | null;
  detectedOrm: string | null;
  detectedTestFramework: string | null;
  detectedBuildTool: string | null;
  detectedCi: string | null;
  isMonorepo: boolean;
  hasDocker: boolean;
  hasOpenApi: boolean;
  packageCount: number;
  moduleCount: number;
  repoSizeBytes: number;
  detectedApis: string[];
  detectedRisks: string[];
  qualityScore: number;
  confidenceScore: number;
  graphSummary: DiscoveryGraphSummary;
  ruleViolations: DiscoveryRuleViolation[];
}

export const discoverySessionsTable = pgTable("discovery_sessions", {
  id: text("id").primaryKey(),
  /**
   * The user who started this discovery session. Sessions can surface
   * filesystem paths, repo contents, and detected secrets/risks for
   * whatever rootPath they scanned, so — like projects — they must be
   * strictly scoped to their creator. Every route that reads or mutates a
   * session by id enforces `ownerId === req.userId` (see routes/discovery.ts).
   */
  ownerId: text("owner_id").notNull(),
  status: discoverySessionStatusEnum("status").notNull().default("discovering"),
  /** Resolved filesystem path used by the scanner pipeline. */
  rootPath: text("root_path").notNull(),
  /** Which source type was used to obtain rootPath. */
  sourceType: sourceTypeEnum("source_type").notNull().default("LOCAL_FOLDER"),
  /** Source-specific configuration provided by the caller. */
  sourceConfig: jsonb("source_config").$type<DiscoverySourceConfig>(),
  progress: integer("progress").notNull().default(0),
  currentStep: text("current_step"),
  /** DB-15: notNull + default([]) — always an array, never NULL. */
  steps: jsonb("steps")
    .$type<DiscoveryStep[]>()
    .notNull()
    .default([]),
  result: jsonb("result").$type<DiscoveryResultData>(),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  importedProjectId: text("imported_project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  /**
   * PR-01 (Durable Jobs): Worker ID that claimed and is running this session.
   * Set atomically on claim (pending→discovering); cleared on completion/error.
   */
  workerId: text("worker_id"),
  /**
   * PR-01: Lease deadline for the current worker. Heartbeated periodically;
   * if it falls behind now() the session is considered abandoned.
   */
  leaseUntil: timestamp("lease_until"),
  /** PR-01: Timestamp of the last successful heartbeat from the worker. */
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  /** PR-01: Stable idempotency key (defaults to session ID) set at creation. */
  idempotencyKey: text("idempotency_key"),
}, (t) => [
  // Covers: reconciliation sweeps — WHERE status IN ('discovering', 'pending')
  index("idx_discovery_sessions_status").on(t.status),
  // Covers: stale-session cleanup — WHERE started_at < now() - interval
  index("idx_discovery_sessions_started_at").on(t.startedAt),
  // Covers: user-scoped listing — WHERE owner_id = ?
  index("idx_discovery_sessions_owner_id").on(t.ownerId),
  // PR-01: Covers lease-expiry detection: WHERE status='discovering' AND lease_until < NOW()
  index("idx_discovery_sessions_status_lease_until").on(t.status, t.leaseUntil),
  /**
   * DB-14: Temporal consistency — completedAt must come after startedAt.
   * Lifecycle state machine (enforced in app code; documented here):
   *   pending → discovering → ready → imported   (happy path)
   *   pending → discovering → error              (failure path)
   * completedAt is set when status transitions to ready/error/imported.
   * startedAt is set on creation and never updated.
   */
  check(
    "chk_discovery_session_completed_at",
    sql`${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.startedAt}`,
  ),
]);

export type InsertDiscoverySession = typeof discoverySessionsTable.$inferInsert;
export type DiscoverySession = typeof discoverySessionsTable.$inferSelect;
