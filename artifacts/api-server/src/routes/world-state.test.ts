import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { aiWorldFactsTable, db, projectsTable } from "@workspace/db";
import app from "../app.js";

const projectIds: string[] = [];

async function insertProject(ownerId: string): Promise<string> {
  const id = `world-state-route-project-${randomUUID()}`;
  projectIds.push(id);
  await db.insert(projectsTable).values({
    id,
    ownerId,
    name: "World State route fixture",
    rootPath: `/tmp/${id}`,
    language: "typescript",
  });
  return id;
}

async function insertFact(input: {
  projectId: string;
  taskScope: string;
  environmentRevision: string | null;
  marker: string;
}) {
  await db.insert(aiWorldFactsTable).values({
    id: randomUUID(),
    projectId: input.projectId,
    taskScope: input.taskScope,
    environmentRevisionKey: input.environmentRevision
      ? `revision:${input.environmentRevision}`
      : "unknown",
    subject: "execution:fixture",
    predicate: "runtime.status",
    value: { marker: input.marker },
    valueHash: input.marker,
    version: 1,
    status: "believed",
    sourceObservationIds: [],
    projectRevision: "revision-1",
    environmentRevision: input.environmentRevision,
  });
}

afterEach(async () => {
  while (projectIds.length > 0) {
    const id = projectIds.pop();
    if (id) await db.delete(projectsTable).where(eq(projectsTable.id, id));
  }
});

describe("GET /api/projects/:projectId/world-state", () => {
  it("returns the bounded read-only projection for the owner", async () => {
    const projectId = await insertProject("test-user");
    await db.insert(aiWorldFactsTable).values({
      id: randomUUID(),
      projectId,
      subject: "execution:fixture",
      predicate: "runtime.status",
      value: { status: "passed" },
      valueHash: "fixture-value-hash",
      version: 1,
      status: "believed",
      sourceObservationIds: ["observation-fixture"],
      projectRevision: "revision-1",
    });

    const response = await request(app).get(`/api/projects/${projectId}/world-state`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projectId,
      facts: [{
        subject: "execution:fixture",
        predicate: "runtime.status",
        status: "believed",
        projectRevision: "revision-1",
      }],
      currentFacts: [{ status: "believed" }],
      contradictions: [],
    });
    expect(response.body.worldRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("enforces project ownership and returns 404 for unknown projects", async () => {
    const privateProjectId = await insertProject("another-user");
    const forbidden = await request(app).get(`/api/projects/${privateProjectId}/world-state`);
    expect(forbidden.status).toBe(403);

    const missing = await request(app).get(`/api/projects/${randomUUID()}/world-state`);
    expect(missing.status).toBe(404);
  });

  it("filters the projection by task scope and environment revision", async () => {
    const projectId = await insertProject("test-user");
    const taskA = `scope:${"a".repeat(64)}`;
    const taskB = `scope:${"b".repeat(64)}`;
    await Promise.all([
      insertFact({ projectId, taskScope: taskA, environmentRevision: "env-a", marker: "a-env-a" }),
      insertFact({ projectId, taskScope: taskA, environmentRevision: "env-b", marker: "a-env-b" }),
      insertFact({ projectId, taskScope: taskA, environmentRevision: null, marker: "a-unbound" }),
      insertFact({ projectId, taskScope: taskB, environmentRevision: "env-a", marker: "b-env-a" }),
    ]);

    const scoped = await request(app)
      .get(`/api/projects/${projectId}/world-state`)
      .query({ taskScope: taskA, environmentRevision: "env-a" });
    expect(scoped.status).toBe(200);
    expect(scoped.body.facts).toHaveLength(1);
    expect(scoped.body.facts[0]).toMatchObject({
      taskScope: taskA,
      environmentRevision: "env-a",
      value: { marker: "a-env-a" },
    });

    const taskOnly = await request(app)
      .get(`/api/projects/${projectId}/world-state`)
      .query({ taskScope: taskA });
    expect(taskOnly.status).toBe(200);
    expect(taskOnly.body.facts).toHaveLength(3);

    const unboundEnvironment = await request(app)
      .get(`/api/projects/${projectId}/world-state`)
      .query({ taskScope: taskA, environmentRevisionUnbound: "true" });
    expect(unboundEnvironment.status).toBe(200);
    expect(unboundEnvironment.body.facts).toHaveLength(1);
    expect(unboundEnvironment.body.facts[0].environmentRevision).toBeNull();
  });

  it("rejects repeated and conflicting World State filters", async () => {
    const projectId = await insertProject("test-user");
    const repeated = await request(app)
      .get(`/api/projects/${projectId}/world-state?taskScope=scope%3Aa&taskScope=scope%3Ab`);
    expect(repeated.status).toBe(400);
    expect(repeated.body.reason).toBe("invalid_world_state_query");

    const conflicting = await request(app)
      .get(`/api/projects/${projectId}/world-state`)
      .query({
        environmentRevision: "env-a",
        environmentRevisionUnbound: "true",
      });
    expect(conflicting.status).toBe(400);
    expect(conflicting.body.reason).toBe("invalid_world_state_query");
  });
});