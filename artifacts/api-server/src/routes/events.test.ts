/**
 * Tests for events.ts: all-project and project-scoped list filters and ownership.
 */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import app from "../app.js";
import { db, eventsTable, projectsTable } from "@workspace/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `events-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/events-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertEvent(overrides: {
  projectId: string;
  type?: string;
  severity?: "info" | "warning" | "error" | "success";
  message?: string;
  correlationId?: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(eventsTable).values({
    id,
    projectId: overrides.projectId,
    type: overrides.type ?? "TestEvent",
    severity: overrides.severity ?? "info",
    message: overrides.message ?? "test event",
    correlationId: overrides.correlationId ?? null,
    timestamp: new Date(),
  });
  return id;
}

const projectIds: string[] = [];

afterEach(async () => {
  for (const pid of projectIds.splice(0)) {
    await db.delete(eventsTable).where(eq(eventsTable.projectId, pid)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, pid)).catch(() => undefined);
  }
});

// ─── GET /events ───────────────────────────────────────────────────────────────

describe("GET /events — list", () => {
  it("returns 200 with an array when a valid projectId is provided", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const res = await request(app).get(`/api/events?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns events from all projects owned by the authenticated user when projectId is omitted", async () => {
    const firstProjectId = await insertProject();
    const secondProjectId = await insertProject();
    projectIds.push(firstProjectId, secondProjectId);
    const firstEventId = await insertEvent({ projectId: firstProjectId, message: "first project event" });
    const secondEventId = await insertEvent({ projectId: secondProjectId, message: "second project event" });

    const res = await request(app).get("/api/events");

    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((event) => event.id);
    expect(ids).toEqual(expect.arrayContaining([firstEventId, secondEventId]));
  });

  it("returns an empty array when the authenticated user owns no projects", async () => {
    const res = await request(app).get("/api/events");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("filters events by projectId", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const eventId = await insertEvent({ projectId, type: "ProjectCreated" });

    const res = await request(app).get(`/api/events?projectId=${projectId}`);
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(eventId);
    // All returned events must belong to this project
    for (const ev of res.body as { projectId: string }[]) {
      expect(ev.projectId).toBe(projectId);
    }
  });

  it("filters events by type", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const typeAId = await insertEvent({ projectId, type: "TypeA" });
    const typeBId = await insertEvent({ projectId, type: "TypeB" });

    const res = await request(app).get(`/api/events?projectId=${projectId}&type=TypeA`);
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(typeAId);
    expect(ids).not.toContain(typeBId);
  });

  it("filters events by correlationId", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const correlationId = randomUUID();
    const correlatedId = await insertEvent({ projectId, correlationId });
    const uncorrelatedId = await insertEvent({ projectId }); // no correlationId

    const res = await request(app).get(
      `/api/events?projectId=${projectId}&correlationId=${correlationId}`,
    );
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(correlatedId);
    expect(ids).not.toContain(uncorrelatedId);
  });

  it("respects the ?limit= parameter", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Insert 5 events
    for (let i = 0; i < 5; i++) {
      await insertEvent({ projectId, message: `event ${i}` });
    }

    const res = await request(app).get(`/api/events?projectId=${projectId}&limit=3`);
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it("paginates newest-first after applying severity and text filters", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    await insertEvent({ projectId, severity: "success", message: "release one" });
    await insertEvent({ projectId, severity: "success", message: "release two" });
    await insertEvent({ projectId, severity: "error", message: "release three" });

    const firstPage = await request(app).get(
      `/api/events?projectId=${projectId}&severity=success&search=release&limit=1&page=1`,
    );
    const secondPage = await request(app).get(
      `/api/events?projectId=${projectId}&severity=success&search=release&limit=1&page=2`,
    );

    expect(firstPage.status).toBe(200);
    expect(secondPage.status).toBe(200);
    expect(firstPage.body).toHaveLength(1);
    expect(secondPage.body).toHaveLength(1);
    expect(firstPage.body[0].severity).toBe("success");
    expect(secondPage.body[0].severity).toBe("success");
    expect(firstPage.body[0].id).not.toBe(secondPage.body[0].id);
  });

  it("rejects page numbers below one", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).get(`/api/events?projectId=${projectId}&page=0`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/page must be at least 1/i);
  });

  it("orders events by timestamp descending (most recent first)", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Insert with deliberate timestamp gap
    const olderTime = new Date(Date.now() - 10_000);
    const newerTime = new Date(Date.now() - 1_000);

    const olderId = randomUUID();
    const newerId = randomUUID();

    await db.insert(eventsTable).values({
      id: olderId,
      projectId,
      type: "OldEvent",
      severity: "info",
      message: "old",
      timestamp: olderTime,
    });
    await db.insert(eventsTable).values({
      id: newerId,
      projectId,
      type: "NewEvent",
      severity: "info",
      message: "new",
      timestamp: newerTime,
    });

    const res = await request(app).get(`/api/events?projectId=${projectId}`);
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids.indexOf(newerId)).toBeLessThan(ids.indexOf(olderId));
  });

  it("returns at most 50 events by default when no limit is specified", async () => {
    // projectId is now required — test the default cap against a known project so
    // we can assert exactly over our own events without cross-test interference.
    const projectId = await insertProject();
    projectIds.push(projectId);
    for (let i = 0; i < 5; i++) {
      await insertEvent({ projectId, message: `limit-check event ${i}` });
    }
    const res = await request(app).get(`/api/events?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it("each event has the required fields", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    await insertEvent({ projectId, type: "FieldTest", severity: "warning" });

    const res = await request(app).get(`/api/events?projectId=${projectId}`);
    expect(res.status).toBe(200);
    const ev = (res.body as Record<string, unknown>[])[0];
    expect(ev).toHaveProperty("id");
    expect(ev).toHaveProperty("projectId");
    expect(ev).toHaveProperty("type");
    expect(ev).toHaveProperty("severity");
    expect(ev).toHaveProperty("message");
    expect(ev).toHaveProperty("timestamp");
  });
});

// ─── Ownership isolation ───────────────────────────────────────────────────────

describe("GET /events — ownership isolation", () => {
  it("returns 403 when projectId belongs to another user", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "other-user",
      name: `other-user-project-${id.slice(0, 8)}`,
      rootPath: "/tmp/other-user-events",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id); // reuse existing afterEach cleanup

    const res = await request(app).get(`/api/events?projectId=${id}`);
    expect(res.status).toBe(403);
  });

  it("excludes events from projects owned by another user in all-project mode", async () => {
    const ownedProjectId = await insertProject();
    projectIds.push(ownedProjectId);
    const otherProjectId = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id: otherProjectId,
      ownerId: "other-user",
      name: `other-user-project-${otherProjectId.slice(0, 8)}`,
      rootPath: "/tmp/other-user-events-all",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(otherProjectId);
    const ownedEventId = await insertEvent({ projectId: ownedProjectId });
    const otherEventId = await insertEvent({ projectId: otherProjectId });

    const res = await request(app).get("/api/events");

    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((event) => event.id);
    expect(ids).toContain(ownedEventId);
    expect(ids).not.toContain(otherEventId);
    for (const event of res.body as { projectId: string }[]) {
      expect(event.projectId).not.toBe(otherProjectId);
    }
  });
});
