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
});