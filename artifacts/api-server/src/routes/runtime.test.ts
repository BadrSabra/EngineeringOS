import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiChatSessionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import app from "../app.js";
import {
  workspaceRuntime,
  type RuntimeAfterState,
  type WorkspaceRuntimeSnapshot,
} from "../lib/workspace-runtime.js";

const TEST_ROOTS_BASE = "/home/runner/workspace/.test-roots";
const fixtures: Array<{ projectId: string; rootPath: string }> = [];

function createRuntimeMock(
  projectId: string,
  revision: string,
  afterOverrides: Partial<RuntimeAfterState> = {},
) {
  const now = new Date().toISOString();
  const snapshot: WorkspaceRuntimeSnapshot = {
    projectId,
    sessionId: `runtime-session-${projectId}`,
    status: "running",
    port: 3001,
    command: "pnpm run dev",
    revision,
    startedAt: now,
    stoppedAt: null,
    pid: 12345,
    leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    lastHeartbeatAt: now,
    error: null,
    logs: [],
  };
  const afterState: RuntimeAfterState = {
    status: "passed",
    projectId,
    sessionId: snapshot.sessionId!,
    revision,
    pid: snapshot.pid,
    port: snapshot.port!,
    processAlive: true,
    portReady: true,
    healthPath: "/healthz",
    healthStatus: 200,
    servingRevision: revision,
    markerMatched: true,
    responseBody: "ok",
    observedAt: now,
    detail: "Runtime after-state verified.",
    ...afterOverrides,
  };

  const startSpy = vi.spyOn(workspaceRuntime, "start").mockResolvedValue(snapshot);
  vi.spyOn(workspaceRuntime, "get").mockResolvedValue(snapshot);
  vi.spyOn(workspaceRuntime, "observeAfterState").mockResolvedValue(afterState);
  return { startSpy, snapshot, afterState };
}

async function createProjectFixture(): Promise<{
  projectId: string;
  rootPath: string;
  sourceRevision: string;
}> {
  const projectId = randomUUID();
  const rootPath = join(TEST_ROOTS_BASE, `runtime-start-${projectId}`);
  mkdirSync(rootPath, { recursive: true });
  writeFileSync(join(rootPath, "package.json"), JSON.stringify({ name: "runtime-route-fixture" }));
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `runtime-route-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  fixtures.push({ projectId, rootPath });
  return { projectId, rootPath, sourceRevision: now.toISOString() };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (!fixture) continue;
    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, fixture.projectId));
    for (const execution of executions) {
      await db.delete(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, execution.id));
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, fixture.projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

describe("POST /api/projects/:projectId/runtime/start", () => {
  it("uses the durable action spine and returns the existing runtime snapshot shape", async () => {
    const fixture = await createProjectFixture();
    const runtime = createRuntimeMock(fixture.projectId, fixture.sourceRevision);
    const idempotencyKey = "runtime-start-route-success-001";

    const first = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/start`)
      .set("Idempotency-Key", idempotencyKey);

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      projectId: fixture.projectId,
      status: "running",
      operationStatus: "completed",
      executionId: expect.any(String),
      operationId: expect.any(String),
      receipt: { status: "completed" },
    });
    expect(runtime.startSpy).toHaveBeenCalledTimes(1);

    const retry = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/start`)
      .set("Idempotency-Key", idempotencyKey);
    expect(retry.status).toBe(200);
    expect(retry.body.executionId).toBe(first.body.executionId);
    expect(retry.body.operationId).toBe(first.body.operationId);
    expect(runtime.startSpy).toHaveBeenCalledTimes(1);

    const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
      .where(eq(aiAgentEffectBundlesTable.executionId, first.body.executionId))
      .limit(1);
    expect(bundle).toMatchObject({ verdict: "OBSERVED" });
    const effects = await db.select().from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.executionId, first.body.executionId));
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ capabilityId: "runtime.start", status: "observed" });
    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, first.body.executionId),
      eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
    )).limit(1);
    expect(acceptance?.effectBundleId).toBe(bundle?.id);
    const observations = await db.select().from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.executionId, first.body.executionId));
    expect(observations.filter((row) => row.provenance === "DIRECT_OBSERVATION")).toHaveLength(2);
    const events = await db.select({ eventType: aiAgentEpisodeEventsTable.eventType })
      .from(aiAgentEpisodeEventsTable)
      .where(eq(aiAgentEpisodeEventsTable.executionId, first.body.executionId));
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_CLASSIFIED"]),
    );
    const [episode] = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.executionId, first.body.executionId))
      .limit(1);
    expect(episode).toMatchObject({
      state: "completed",
      verdict: "achieved",
      reasonCode: "CANONICAL_PROOF_PROVEN",
    });
  });

  it("does not accept an unavailable stale after-state", async () => {
    const fixture = await createProjectFixture();
    createRuntimeMock(fixture.projectId, fixture.sourceRevision, {
      status: "unavailable",
      revision: "stale-runtime-revision",
      detail: "Runtime after-state did not match the requested revision.",
    });

    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/start`)
      .set("Idempotency-Key", "runtime-start-route-stale-001");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      status: "running",
      operationStatus: "blocked",
      code: "RUNTIME_START_NOT_VERIFIED",
    });
    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, fixture.projectId));
    expect(executions).toHaveLength(1);
    const acceptances = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executions[0]!.id));
    expect(acceptances.some((row) => row.outcome === "SUCCEEDED")).toBe(false);
    expect(acceptances.every((row) => row.effectBundleId === null)).toBe(true);
  });
});