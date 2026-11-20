import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { db, projectsTable, metricsTable } from "@workspace/db";
import { randomUUID } from "crypto";

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `metrics-test-project-${id.slice(0, 8)}`,
    rootPath: `/tmp/metrics-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function cleanupProject(id: string): Promise<void> {
  await db.delete(metricsTable).where(eq(metricsTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}

describe("Metrics endpoints", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns time-series metrics ordered by timestamp, scoped to a project", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    await db.insert(metricsTable).values([
      { id: randomUUID(), projectId, timestamp: newer, overallScore: 90 },
      { id: randomUUID(), projectId, timestamp: older, overallScore: 70 },
    ]);

    const res = await request(app).get("/api/metrics").query({ projectId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].overallScore).toBe(70);
    expect(res.body[1].overallScore).toBe(90);
  });

  it("returns only the latest metric per project from /metrics/latest", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    await db.insert(metricsTable).values([
      { id: randomUUID(), projectId, timestamp: older, overallScore: 50 },
      { id: randomUUID(), projectId, timestamp: newer, overallScore: 95 },
    ]);

    const res = await request(app).get("/api/metrics/latest").query({ projectId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].overallScore).toBe(95);
  });

  it("returns only the latest metric per owned project and orders ties deterministically", async () => {
    const firstProjectId = await insertProject();
    const secondProjectId = await insertProject();
    const otherProjectId = randomUUID();
    cleanupQueue.push(firstProjectId, secondProjectId, otherProjectId);

    const now = Date.now();
    const oldTimestamp = new Date(now - 20_000);
    const secondLatestTimestamp = new Date(now - 2_000);
    const newestTimestamp = new Date(now - 1_000);

    await db.insert(projectsTable).values({
      id: otherProjectId,
      ownerId: "other-user",
      name: `other-user-project-${otherProjectId.slice(0, 8)}`,
      rootPath: `/tmp/other-user-metrics-${otherProjectId}`,
      language: "typescript",
      status: "active",
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });

    await db.insert(metricsTable).values([
      { id: randomUUID(), projectId: firstProjectId, timestamp: oldTimestamp, overallScore: 10 },
      { id: "00000000-0000-4000-8000-000000000001", projectId: firstProjectId, timestamp: newestTimestamp, overallScore: 80 },
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", projectId: firstProjectId, timestamp: newestTimestamp, overallScore: 85 },
      { id: randomUUID(), projectId: secondProjectId, timestamp: oldTimestamp, overallScore: 20 },
      { id: randomUUID(), projectId: secondProjectId, timestamp: secondLatestTimestamp, overallScore: 70 },
      { id: randomUUID(), projectId: otherProjectId, timestamp: new Date(now), overallScore: 999 },
    ]);

    const res = await request(app).get("/api/metrics/latest");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((row: { projectId: string }) => row.projectId)).toEqual([
      firstProjectId,
      secondProjectId,
    ]);
    expect(res.body.map((row: { overallScore: number }) => row.overallScore)).toEqual([85, 70]);
  });

  it("returns an empty array when a project has no metrics yet", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const res = await request(app).get("/api/metrics").query({ projectId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── Ownership isolation ───────────────────────────────────────────────────────

describe("Ownership isolation — metrics", () => {
  const isolationCleanup: string[] = [];

  afterEach(async () => {
    while (isolationCleanup.length > 0) {
      const id = isolationCleanup.pop();
      if (id) await cleanupProject(id);
    }
  });

  async function insertOtherUserProject(): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "other-user",
      name: `other-user-project-${id.slice(0, 8)}`,
      rootPath: `/tmp/other-user-metrics-${id}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  it("GET /metrics returns 403 when projectId belongs to another user", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const res = await request(app).get("/api/metrics").query({ projectId: otherProjectId });
    expect(res.status).toBe(403);
  });

  it("GET /metrics/latest returns 403 when projectId belongs to another user", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const res = await request(app).get("/api/metrics/latest").query({ projectId: otherProjectId });
    expect(res.status).toBe(403);
  });
});
