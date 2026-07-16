import { pgTable, text, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

// Session-level status (the discoverySessionsTable.status column below).
// Distinct from DiscoveryStep["status"], which tracks each individual
// pipeline step (pending/running/done/error) inside the `steps` jsonb array.
export const discoverySessionStatusEnum = pgEnum("discovery_session_status", [
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
  steps: jsonb("steps")
    .$type<DiscoveryStep[]>()
    .default([]),
  result: jsonb("result").$type<DiscoveryResultData>(),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  importedProjectId: text("imported_project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
});

export type InsertDiscoverySession = typeof discoverySessionsTable.$inferInsert;
export type DiscoverySession = typeof discoverySessionsTable.$inferSelect;
