import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  db,
  discoverySessionsTable,
  projectsTable,
  metricsTable,
  eventsTable,
  tasksTable,
} from "@workspace/db";
import { randomUUID } from "crypto";
import type { DiscoveryResultData } from "@workspace/db";

let sessionId: string | null = null;
let projectId: string | null = null;

function fakeResult(overrides: Partial<DiscoveryResultData> = {}): DiscoveryResultData {
  return {
    detectedName: "test-project",
    detectedLanguage: "typescript",
    detectedLanguages: ["typescript"],
    detectedFramework: null,
    detectedRuntime: "Node.js",
    detectedPackageManager: "pnpm",
    detectedArchitecture: "Monolith",
    detectedDb: null,
    detectedOrm: null,
    detectedTestFramework: null,
    detectedBuildTool: null,
    detectedCi: null,
    isMonorepo: false,
    hasDocker: false,
    hasOpenApi: false,
    packageCount: 1,
    moduleCount: 3,
    repoSizeBytes: 1024,
    detectedApis: [],
    detectedRisks: [],
    qualityScore: 80,
    confidenceScore: 90,
    graphSummary: { entityCount: 0, relationshipCount: 0 },
    ruleViolations: [],
    ...overrides,
  };
}

async function insertReadySession(result: DiscoveryResultData): Promise<string> {
  const id = randomUUID();
  await db.insert(discoverySessionsTable).values({
    id,
    status: "ready",
    rootPath: "/tmp/fake-root",
    source: "local",
    progress: 100,
    currentStep: null,
    steps: [],
    result,
    startedAt: new Date(),
    completedAt: new Date(),
  });
  sessionId = id;
  return id;
}

async function cleanupSessionAndProject(): Promise<void> {
  if (projectId) {
    await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
    await db.delete(metricsTable).where(eq(metricsTable.projectId, projectId));
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    projectId = null;
  }
  if (sessionId) {
    await db.delete(discoverySessionsTable).where(eq(discoverySessionsTable.id, sessionId));
    sessionId = null;
  }
}

describe("POST /api/projects/import — atomic claim", () => {
  afterEach(cleanupSessionAndProject);

  it("imports a ready session exactly once and rejects a concurrent second import", async () => {
    const discoveryId = await insertReadySession(fakeResult());

    const [first, second] = await Promise.all([
      request(app).post("/api/projects/import").send({ discoveryId }),
      request(app).post("/api/projects/import").send({ discoveryId }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = first.status === 201 ? first : second;
    projectId = winner.body.id;

    // DB-level proof: exactly one project row exists for this discovery
    // session's imported id, and the session was claimed exactly once.
    const projectRows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, winner.body.id));
    expect(projectRows).toHaveLength(1);

    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, discoveryId))
      .limit(1);
    expect(session[0]?.status).toBe("imported");
    expect(session[0]?.importedProjectId).toBe(winner.body.id);
  });

  it("returns 409 when importing a session that is not in ready state", async () => {
    const discoveryId = await insertReadySession(fakeResult());
    await db
      .update(discoverySessionsTable)
      .set({ status: "discovering" })
      .where(eq(discoverySessionsTable.id, discoveryId));

    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(409);
  });

  it("returns 404 for an unknown discovery session", async () => {
    const res = await request(app)
      .post("/api/projects/import")
      .send({ discoveryId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it("creates tasks capped at 20 from rule violations on import", async () => {
    const violations = Array.from({ length: 30 }, (_, i) => ({
      code: `RULE_${i}`,
      title: `Violation ${i}`,
      severity: "medium",
      count: 1,
    }));
    const discoveryId = await insertReadySession(fakeResult({ ruleViolations: violations }));

    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, res.body.id));
    expect(tasks.length).toBe(20);
  });
});
