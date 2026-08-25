/**
 * Unit tests for context-loader domain loaders.
 *
 * Each domain loader is tested independently by calling it with a mock
 * Queryable object — no HTTP, no real DB, no transaction overhead.
 * The mock mirrors the chain used by the existing context-builder.test.ts
 * so the two suites share the same structural pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: shared mock state ─────────────────────────────────────────────
const { _tableData, _mockDb } = vi.hoisted(() => {
  const _tableData = new Map<object, unknown[]>();

  function makeChain(rows: unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => Promise.resolve(rows);
    return c;
  }

  interface MockDb {
    select: (fields?: unknown) => { from: (table: object) => Record<string, unknown> };
  }

  const _mockDb: MockDb = {
    select: (_fields?: unknown) => ({
      from: (table: object) => makeChain(_tableData.get(table) ?? []),
    }),
  };

  return { _tableData, _mockDb };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => Symbol("eq")),
  desc: vi.fn((c: unknown) => c),
  asc: vi.fn((c: unknown) => c),
  and: vi.fn(() => Symbol("and")),
}));

vi.mock("@workspace/db", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(_mockDb),
  },
  projectsTable: { _t: "projects" },
  tasksTable: { _t: "tasks" },
  metricsTable: { _t: "metrics" },
  graphEntitiesTable: { _t: "graphEntities" },
  graphRelationshipsTable: { _t: "graphRelationships" },
  eventsTable: { _t: "events" },
  workflowsTable: { _t: "workflows" },
  scanJobsTable: { _t: "scanJobs" },
  eq: vi.fn(),
  desc: vi.fn((c: unknown) => c),
  asc: vi.fn((c: unknown) => c),
  and: vi.fn(),
}));

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
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  loadProject,
  loadTasks,
  loadMetrics,
  loadGraph,
  loadEvents,
  loadWorkflow,
  loadScanJobs,
} from "../context-loader.js";

// Cast the mock to Queryable — structurally compatible for test purposes.
const q = _mockDb as unknown as NodePgDatabase<Record<string, unknown>>;

const PROJECT_ID = "proj-loader-test-001";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProject(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: PROJECT_ID,
    name: "TestProject",
    language: "TypeScript",
    framework: "Express",
    status: "active",
    qualityScore: 80,
    rootPath: "/workspace/test",
    description: "A test project",
    lastScanAt: new Date("2026-07-18"),
    gitRemoteUrl: null,
    gitDefaultBranch: null,
    ownerId: "user-001",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-07-18"),
    ...overrides,
  };
}

function makeTask(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "task-001",
    projectId: PROJECT_ID,
    title: "Fix the bug",
    status: "pending",
    priority: "p1",
    phase: null,
    relatedFiles: [],
    description: "A task",
    updatedAt: new Date("2026-07-18"),
    createdAt: new Date("2026-07-01"),
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
    structuralTestEstimate: 70,
    lintIssues: 3,
    ...overrides,
  };
}

function makeEntity(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "entity-001",
    name: "AuthService",
    type: "service",
    path: "auth.ts",
    kind: null,
    confidence: 0.95,
    domain: null,
    description: null,
    sourceType: "typescript-ast",
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function makeRelationship(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "rel-001",
    sourceId: "entity-001",
    targetId: "entity-002",
    relation: "depends_on",
    relationType: "dependency",
    confidence: 0.9,
    isHeuristic: false,
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "event-001",
    type: "scan.completed",
    projectId: PROJECT_ID,
    severity: "info",
    message: "Scan finished",
    timestamp: new Date("2026-07-18"),
    taskId: null,
    workflowId: null,
    correlationId: null,
    ...overrides,
  };
}

function makeWorkflow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "wf-001",
    projectId: PROJECT_ID,
    name: "CI Pipeline",
    status: "idle",
    phases: [{ name: "build", steps: [], condition: undefined }],
    currentPhase: null,
    executionCount: 3,
    lastExecutedAt: new Date("2026-07-17"),
    description: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-07-17"),
    ...overrides,
  };
}

function makeScanJob(status = "completed") {
  return { status, error: null, finishedAt: new Date("2026-07-18") };
}

// ─── loadProject ──────────────────────────────────────────────────────────────

describe("loadProject", () => {
  it("returns the project row when found", async () => {
    _tableData.set(projectsTable as object, [makeProject()]);
    const row = await loadProject(q, PROJECT_ID);
    expect(row.id).toBe(PROJECT_ID);
    expect(row.name).toBe("TestProject");
  });

  it("throws when the project is not found", async () => {
    _tableData.set(projectsTable as object, []);
    await expect(loadProject(q, PROJECT_ID)).rejects.toThrow(PROJECT_ID);
  });

  it("returns the first row when multiple exist (limit 1)", async () => {
    _tableData.set(projectsTable as object, [
      makeProject({ name: "First" }),
      makeProject({ name: "Second" }),
    ]);
    const row = await loadProject(q, PROJECT_ID);
    expect(row.name).toBe("First");
  });
});

// ─── loadTasks ────────────────────────────────────────────────────────────────

describe("loadTasks", () => {
  it("returns an array of task rows", async () => {
    _tableData.set(tasksTable as object, [makeTask(), makeTask({ id: "task-002", title: "Other" })]);
    const rows = await loadTasks(q, PROJECT_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("Fix the bug");
  });

  it("returns an empty array when no tasks exist", async () => {
    _tableData.set(tasksTable as object, []);
    const rows = await loadTasks(q, PROJECT_ID);
    expect(rows).toEqual([]);
  });

  it("task rows have the expected shape", async () => {
    _tableData.set(tasksTable as object, [makeTask()]);
    const [row] = await loadTasks(q, PROJECT_ID);
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("title");
    expect(row).toHaveProperty("status");
    expect(row).toHaveProperty("priority");
    expect(row).toHaveProperty("relatedFiles");
    expect(row).toHaveProperty("updatedAt");
  });
});

// ─── loadMetrics ──────────────────────────────────────────────────────────────

describe("loadMetrics", () => {
  it("returns the metric row when present", async () => {
    _tableData.set(metricsTable as object, [makeMetric()]);
    const row = await loadMetrics(q, PROJECT_ID);
    expect(row).toBeDefined();
    expect(row?.overallScore).toBe(80);
  });

  it("returns undefined when no metrics exist", async () => {
    _tableData.set(metricsTable as object, []);
    const row = await loadMetrics(q, PROJECT_ID);
    expect(row).toBeUndefined();
  });

  it("metric row has the expected numeric fields", async () => {
    _tableData.set(metricsTable as object, [makeMetric()]);
    const row = await loadMetrics(q, PROJECT_ID);
    expect(typeof row?.overallScore).toBe("number");
    expect(typeof row?.testsTotal).toBe("number");
  });
});

// ─── loadGraph ────────────────────────────────────────────────────────────────

describe("loadGraph", () => {
  beforeEach(() => {
    _tableData.set(graphEntitiesTable as object, [makeEntity()]);
    _tableData.set(graphRelationshipsTable as object, [makeRelationship()]);
  });

  it("returns entities and relationships when both are wanted", async () => {
    const { entities, relationships } = await loadGraph(q, PROJECT_ID, true, true);
    expect(entities).toHaveLength(1);
    expect(relationships).toHaveLength(1);
  });

  it("returns only entities when relationships not wanted", async () => {
    const { entities, relationships } = await loadGraph(q, PROJECT_ID, true, false);
    expect(entities).toHaveLength(1);
    expect(relationships).toEqual([]);
  });

  it("returns only relationships when entities not wanted", async () => {
    const { entities, relationships } = await loadGraph(q, PROJECT_ID, false, true);
    expect(entities).toEqual([]);
    expect(relationships).toHaveLength(1);
  });

  it("returns empty arrays when neither is wanted", async () => {
    const { entities, relationships } = await loadGraph(q, PROJECT_ID, false, false);
    expect(entities).toEqual([]);
    expect(relationships).toEqual([]);
  });

  it("entity rows have the expected shape", async () => {
    const { entities } = await loadGraph(q, PROJECT_ID, true, false);
    const [e] = entities;
    expect(e).toHaveProperty("id");
    expect(e).toHaveProperty("name");
    expect(e).toHaveProperty("type");
    expect(e).toHaveProperty("confidence");
  });

  it("relationship rows have the projected shape", async () => {
    const { relationships } = await loadGraph(q, PROJECT_ID, false, true);
    const [r] = relationships;
    expect(r).toHaveProperty("id");
    expect(r).toHaveProperty("sourceId");
    expect(r).toHaveProperty("targetId");
    expect(r).toHaveProperty("relation");
    expect(r).toHaveProperty("relationType");
    expect(r).toHaveProperty("confidence");
    expect(r).toHaveProperty("isHeuristic");
  });
});

// ─── loadEvents ───────────────────────────────────────────────────────────────

describe("loadEvents", () => {
  it("returns event rows", async () => {
    _tableData.set(eventsTable as object, [makeEvent()]);
    const rows = await loadEvents(q, PROJECT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("scan.completed");
  });

  it("returns empty array when no events exist", async () => {
    _tableData.set(eventsTable as object, []);
    const rows = await loadEvents(q, PROJECT_ID);
    expect(rows).toEqual([]);
  });

  it("event rows have the expected shape", async () => {
    _tableData.set(eventsTable as object, [makeEvent()]);
    const [row] = await loadEvents(q, PROJECT_ID);
    expect(row).toHaveProperty("timestamp");
    expect(row).toHaveProperty("severity");
    expect(row).toHaveProperty("message");
    expect(row).toHaveProperty("taskId");
    expect(row).toHaveProperty("workflowId");
  });
});

// ─── loadWorkflow ─────────────────────────────────────────────────────────────

describe("loadWorkflow", () => {
  it("returns workflow rows", async () => {
    _tableData.set(workflowsTable as object, [makeWorkflow()]);
    const rows = await loadWorkflow(q, PROJECT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("CI Pipeline");
  });

  it("returns empty array when no workflows exist", async () => {
    _tableData.set(workflowsTable as object, []);
    const rows = await loadWorkflow(q, PROJECT_ID);
    expect(rows).toEqual([]);
  });

  it("workflow rows have the expected shape", async () => {
    _tableData.set(workflowsTable as object, [makeWorkflow()]);
    const [row] = await loadWorkflow(q, PROJECT_ID);
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("name");
    expect(row).toHaveProperty("status");
    expect(row).toHaveProperty("phases");
    expect(row).toHaveProperty("executionCount");
    expect(row).toHaveProperty("lastExecutedAt");
  });
});

// ─── loadScanJobs ─────────────────────────────────────────────────────────────

describe("loadScanJobs", () => {
  it("returns the scan job row when present", async () => {
    _tableData.set(scanJobsTable as object, [makeScanJob("completed")]);
    const row = await loadScanJobs(q, PROJECT_ID);
    expect(row).toBeDefined();
    expect(row?.status).toBe("completed");
  });

  it("returns undefined when no scan jobs exist", async () => {
    _tableData.set(scanJobsTable as object, []);
    const row = await loadScanJobs(q, PROJECT_ID);
    expect(row).toBeUndefined();
  });

  it("scan job row has the projected shape (status, error, finishedAt)", async () => {
    _tableData.set(scanJobsTable as object, [makeScanJob("failed")]);
    const row = await loadScanJobs(q, PROJECT_ID);
    expect(row).toHaveProperty("status");
    expect(row).toHaveProperty("error");
    expect(row).toHaveProperty("finishedAt");
  });

  it("returns failed status correctly", async () => {
    _tableData.set(scanJobsTable as object, [makeScanJob("failed")]);
    const row = await loadScanJobs(q, PROJECT_ID);
    expect(row?.status).toBe("failed");
  });

  it("returns queued status correctly", async () => {
    _tableData.set(scanJobsTable as object, [makeScanJob("queued")]);
    const row = await loadScanJobs(q, PROJECT_ID);
    expect(row?.status).toBe("queued");
  });
});
