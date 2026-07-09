import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

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
  status: text("status").notNull().default("discovering"),
  rootPath: text("root_path").notNull(),
  source: text("source").notNull().default("local"),
  progress: integer("progress").notNull().default(0),
  currentStep: text("current_step"),
  steps: jsonb("steps")
    .$type<DiscoveryStep[]>()
    .default([]),
  result: jsonb("result").$type<DiscoveryResultData>(),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  importedProjectId: text("imported_project_id"),
});

export type InsertDiscoverySession = typeof discoverySessionsTable.$inferInsert;
export type DiscoverySession = typeof discoverySessionsTable.$inferSelect;
