/**
 * Integration test: buildProjectContext → AgentContextSchema
 *
 * Gap closure: every agent's system prompt is built from the object returned by
 * buildProjectContext(). If the builder produces a field that violates
 * AgentContextSchema (empty string, missing key, extra key), every downstream
 * agent silently receives corrupt context. These tests prove the builder output
 * always satisfies the schema contract, including edge-case DB states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: initialise shared state before vi.mock hoisting ───────────────
// vi.mock factories are hoisted to the very top of the file by vitest.
// Module-level `const` are NOT initialised yet at that point (temporal dead
// zone). vi.hoisted() runs its callback before hoisting and returns values that
// ARE safe to reference inside a vi.mock factory.
const { _tableData, _mockDb } = vi.hoisted(() => {
  const _tableData = new Map<object, unknown[]>();

  function makeChain(rows: unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    // .where() and .orderBy() return the same chain (chainable, args ignored).
    c.where   = () => c;
    c.orderBy = () => c;
    // .limit() is the terminal call — resolves the Promise with the row array.
    c.limit   = () => Promise.resolve(rows);
    return c;
  }

  const _mockDb = {
    // select() accepts optional field projections but we ignore them — the mock
    // always returns the full pre-configured row arrays.
    select: () => ({
      from: (table: object) => makeChain(_tableData.get(table) ?? []),
    }),
  };

  return { _tableData, _mockDb };
});

// ── Drizzle helper mock ───────────────────────────────────────────────────────
// eq/desc/asc results are passed to .where()/.orderBy() in the mock chain,
// which discards them. vi.fn() keeps them from throwing when called with
// undefined column references from our token-based table mocks.
vi.mock("drizzle-orm", () => ({
  eq:   vi.fn(() => Symbol("eq")),
  desc: vi.fn((c: unknown) => c),
  asc:  vi.fn((c: unknown) => c),
  and:  vi.fn(() => Symbol("and")),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// buildProjectContext runs 8 parallel drizzle queries via the fluent chain:
//   db.select(fields?).from(TABLE).where(cond).orderBy(ord).limit(n) → rows[]
//
// Each table export is a unique plain-object token. .from(TOKEN) intercepts
// the token and returns the pre-configured rows from _tableData. Tests
// overwrite entries in _tableData to simulate edge-case DB states.
vi.mock("@workspace/db", () => ({
  db: _mockDb,
  // Unique object references serve as table tokens — context-builder and test
  // both import these, so they share the same Map keys in _tableData.
  projectsTable:            { _t: "projects" },
  tasksTable:               { _t: "tasks" },
  metricsTable:             { _t: "metrics" },
  graphEntitiesTable:       { _t: "graphEntities" },
  graphRelationshipsTable:  { _t: "graphRelationships" },
  eventsTable:              { _t: "events" },
  workflowsTable:           { _t: "workflows" },
  scanJobsTable:            { _t: "scanJobs" },
  // Extra drizzle exports used by context-builder (not query-related)
  eq:   vi.fn(),
  desc: vi.fn((c: unknown) => c),
  asc:  vi.fn((c: unknown) => c),
  and:  vi.fn(),
}));

// Imports come AFTER vi.mock declarations (vitest hoists vi.mock calls).
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
import { buildProjectContext, invalidateContextCache } from "./context-builder.js";
import { AgentContextSchema } from "./schemas/context.schema.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID = "proj-ctx-test-001";

function makeProject(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: PROJECT_ID,
    name: "TestProject",
    language: "TypeScript",
    framework: "Express",
    status: "active",
    qualityScore: 80,
    rootPath: "/workspace/test",
    description: "A test project for context-builder validation",
    lastScanAt: new Date("2026-07-18"),
    gitRemoteUrl: null,
    gitDefaultBranch: null,
    ...overrides,
  };
}

function makeMetric(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "metric-001",
    projectId: PROJECT_ID,
    timestamp: new Date("2026-07-18"),
    overallScore: 80,
    architectureScore: 75,
    securityScore: 85,
    performanceScore: 78,
    reliabilityScore: 82,
    maintainabilityScore: 79,
    technicalDebt: 12,
    buildStatus: "passing",
    testsTotal: 100,
    testsPassed: 98,
    testsFailed: 2,
    testsCoverage: 87,
    linesOfCode: 5000,
    complexity: 3.2,
    dependencies: 42,
    ...overrides,
  };
}

function makeScanJob(status = "completed") {
  return { status, error: null, finishedAt: new Date("2026-07-18") };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildProjectContext → AgentContextSchema", () => {
  beforeEach(() => {
    // Reset context cache so each test triggers a fresh builder run.
    invalidateContextCache(PROJECT_ID);
    // Reset DB data to a minimal valid state for each test.
    _tableData.clear();
    _tableData.set(projectsTable as object, [makeProject()]);
    _tableData.set(tasksTable as object, []);
    _tableData.set(metricsTable as object, [makeMetric()]);
    _tableData.set(graphEntitiesTable as object, []);
    _tableData.set(graphRelationshipsTable as object, []);
    _tableData.set(eventsTable as object, []);
    _tableData.set(workflowsTable as object, []);
    _tableData.set(scanJobsTable as object, [makeScanJob()]);
  });

  it("output satisfies AgentContextSchema (core gap assertion)", async () => {
    const ctx = await buildProjectContext(PROJECT_ID);
    // AgentContextSchema.parse() throws a ZodError if any field is empty,
    // missing, or carries an unexpected key — this is the contract every agent
    // depends on at runtime.
    expect(() => AgentContextSchema.parse(ctx)).not.toThrow();
  });

  it("all string fields are non-empty (schema min(1) contract)", async () => {
    const ctx = await buildProjectContext(PROJECT_ID);
    const parsed = AgentContextSchema.safeParse(ctx);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    for (const [key, value] of Object.entries(parsed.data)) {
      expect(value.length, `AgentContext field "${key}" must satisfy min(1)`).toBeGreaterThan(0);
    }
  });

  it("no extra keys leak through (schema .strict() contract)", async () => {
    const ctx = await buildProjectContext(PROJECT_ID);
    const result = AgentContextSchema.strict().safeParse(ctx);
    expect(result.success).toBe(true);
  });

  it("gracefully handles empty tasks, metrics, events, and workflows", async () => {
    _tableData.set(tasksTable as object, []);
    _tableData.set(metricsTable as object, []);   // no metrics row
    _tableData.set(graphEntitiesTable as object, []);
    _tableData.set(graphRelationshipsTable as object, []);
    _tableData.set(eventsTable as object, []);
    _tableData.set(workflowsTable as object, []);
    _tableData.set(scanJobsTable as object, []); // no scan job

    invalidateContextCache(PROJECT_ID);
    const ctx = await buildProjectContext(PROJECT_ID);
    expect(() => AgentContextSchema.parse(ctx)).not.toThrow();
  });

  it("includes scan-reliability label in the project field", async () => {
    const ctx = await buildProjectContext(PROJECT_ID);
    // With a completed scan job the builder marks the context as "completed".
    expect(ctx.project).toContain("completed");
  });

  it("marks metrics as unverified when scan never ran", async () => {
    _tableData.set(scanJobsTable as object, []); // no scan job at all
    invalidateContextCache(PROJECT_ID);
    const ctx = await buildProjectContext(PROJECT_ID);
    // The builder appends "⚠ unverified" when there is no completed scan.
    expect(ctx.project).toContain("unverified");
  });

  it("throws when the project row is absent", async () => {
    _tableData.set(projectsTable as object, []); // project not found
    invalidateContextCache(PROJECT_ID);
    await expect(buildProjectContext(PROJECT_ID)).rejects.toThrow(PROJECT_ID);
  });

  it("includes relationship topology when graph edges exist", async () => {
    _tableData.set(graphEntitiesTable as object, [
      { id: "e1", name: "AuthService", type: "service",    filePath: "auth.ts",  confidence: 0.95 },
      { id: "e2", name: "UserRepo",    type: "repository", filePath: "user.ts",  confidence: 0.90 },
    ]);
    _tableData.set(graphRelationshipsTable as object, [
      {
        id: "r1", sourceId: "e1", targetId: "e2",
        relation: "depends_on", relationType: "dependency",
        confidence: 0.88, isHeuristic: false,
      },
    ]);
    invalidateContextCache(PROJECT_ID);
    const ctx = await buildProjectContext(PROJECT_ID);
    expect(ctx.graphSummary).toMatch(/AuthService|UserRepo/);
    expect(() => AgentContextSchema.parse(ctx)).not.toThrow();
  });
});
