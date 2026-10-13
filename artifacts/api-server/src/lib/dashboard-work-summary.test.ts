import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  db, projectsTable, tasksTable, aiMissionsTable, aiGoalsTable, aiExecutionsTable, pool,
} from "@workspace/db";
import { isProjectWorkRequest, loadDashboardWorkSummary, WORK_SECTION_LIMIT } from "./dashboard-work-summary.js";
import dashboardRouter from "../routes/dashboard.js";

vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth(req: any, res: any, next: () => void) {
    if (!req.headers["x-test-user"]) return res.status(401).json({ error: "unauthorized" });
    req.userId = req.headers["x-test-user"];
    next();
  },
}));

const owner = `summary-${randomUUID()}`;
const foreign = `summary-other-${randomUUID()}`;
const roots: string[] = [];
const app = express().use("/api", dashboardRouter);

beforeAll(() => {
  const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
  if (target.hostname !== "127.0.0.1" || target.port !== "55487" || target.username !== "runner") {
    throw new Error("This suite requires the explicit disposable loopback summary test database.");
  }
});
afterEach(async () => {
  if (roots.length) await db.delete(projectsTable).where(inArray(projectsTable.id, roots.splice(0)));
});
afterAll(async () => { await pool.end(); });

async function project(userId = owner) {
  const id = randomUUID();
  roots.push(id);
  await db.insert(projectsTable).values({ id, ownerId: userId, name: "Owned project", rootPath: `/tmp/summary-fixture-${id}`, language: "typescript" });
  return id;
}
async function mission(projectId: string, status: "active" | "completed" = "active", revision = "current") {
  const id = randomUUID();
  await db.insert(aiMissionsTable).values({
    id, projectId, userId: owner, title: "An objective", intent: "test",
    status, scope: { kind: "project", projectId }, autonomyPolicy: { activePlanRevision: revision },
  });
  return id;
}
async function goal(projectId: string, missionId: string, status: "waiting_for_approval" | "completed" | "running", revision: unknown = "current") {
  const id = randomUUID();
  await db.insert(aiGoalsTable).values({
    id, projectId, missionId, title: "goal", status,
    outcomeContract: { planRevision: { hash: revision } },
  });
  return id;
}
async function task(projectId: string, status: "running" | "completed" = "running", goalId?: string) {
  const id = randomUUID();
  await db.insert(tasksTable).values({ id, projectId, title: "Task", status, goalId });
  return id;
}
async function execution(projectId: string, options: {
  status?: "running" | "paused" | "completed"; linkedTaskId?: string; goalId?: string;
  userId?: string; turnIntent?: string; createdAt?: Date; operationId?: string;
} = {}) {
  const id = randomUUID();
  await db.insert(aiExecutionsTable).values({
    id, projectId, userId: options.userId ?? owner, idempotencyKey: id,
    resumeTokenHash: "fixture-noncredential-hash", attempt: 3,
    request: JSON.stringify({ projectId, turnIntent: options.turnIntent ?? "PROJECT_QUERY" }),
    status: options.status ?? "running", linkedTaskId: options.linkedTaskId,
    goalId: options.goalId, createdAt: options.createdAt,
    operationId: options.operationId,
  });
  return id;
}

describe("bounded dashboard inventory", () => {
  it("ignores query identity, scopes every source to the authenticated owner, and denies anonymous reads", async () => {
    const owned = await project();
    const other = await project(foreign);
    const mine = await task(owned, "completed");
    await task(other);
    await execution(owned, { userId: foreign });
    await execution(other, { userId: owner });
    await db.insert(aiMissionsTable).values({
      id: randomUUID(), userId: foreign, projectId: owned, title: "Foreign mission",
      intent: "foreign", status: "blocked", scope: { kind: "project", projectId: owned },
    });
    const response = await request(app).get(`/api/dashboard/work-summary?userId=${foreign}`).set("x-test-user", owner);
    expect(response.status).toBe(200);
    expect(response.body.recent.map((item: any) => item.id)).toEqual([mine]);
    expect(response.body.active).toEqual([]);
    expect(response.body.decisions).toEqual([]);
    expect(response.body.recent[0].stateBasis).toBe("recorded_only");
    expect(response.body.coverage.verification).toBe("not_revalidated");
    expect(response.body.coverage.totalCountAvailable).toBe(false);
    expect((await request(app).get("/api/dashboard/work-summary")).status).toBe(401);
  });

  it("deduplicates explicit current-plan children but retains historical work without inventing a plan binding", async () => {
    const p = await project();
    const m = await mission(p);
    const current = await goal(p, m, "waiting_for_approval");
    const old = await goal(p, m, "completed", "old");
    const child = await task(p, "running", current);
    const historical = await task(p, "running", old);
    await execution(p, { goalId: current });
    await execution(p, { linkedTaskId: child });
    const independent = await execution(p);
    await execution(p, { turnIntent: "CHAT" });
    const summary = await loadDashboardWorkSummary(owner);
    expect(summary.decisions.map((item) => item.id)).toEqual([m]);
    expect(summary.decisions[0].planBinding).toBe("current_plan");
    expect(summary.active.some((item) => item.id === child)).toBe(false);
    expect(summary.active.find((item) => item.id === historical)?.planBinding).toBe("needs_details");
    expect(summary.active.find((item) => item.id === independent)?.attempt).toBe(3);
    expect(summary.coverage.excludedExecutionCount).toBe(1);
    expect(summary.coverage.partial).toBe(true);
  });

  it("does not coerce numeric historical hashes into a current string revision", async () => {
    const p = await project();
    const m = await mission(p, "active", "17");
    const g = await goal(p, m, "waiting_for_approval", 17);
    const t = await task(p, "running", g);
    const summary = await loadDashboardWorkSummary(owner);
    expect(summary.decisions).toEqual([]);
    expect(summary.active.find((item) => item.id === m)?.planBinding).toBe("revision_mismatch");
    expect(summary.active.some((item) => item.id === t)).toBe(true);
  });

  it("does not let an older paused execution demand a decision after a newer run exists", async () => {
    const p = await project();
    const t = await task(p);
    await execution(p, { linkedTaskId: t, status: "paused", createdAt: new Date("2026-01-01") });
    expect((await loadDashboardWorkSummary(owner)).decisions.map((item) => item.id)).toEqual([t]);
    await execution(p, { linkedTaskId: t, status: "completed", createdAt: new Date("2026-01-02") });
    const summary = await loadDashboardWorkSummary(owner);
    expect(summary.decisions).toEqual([]);
    expect(summary.active.map((item) => item.id)).toEqual([t]);
  });

  it("keeps review items independently available under active-work load and declares sampling", async () => {
    const p = await project();
    const m = await mission(p);
    await goal(p, m, "waiting_for_approval");
    for (let i = 0; i < 20; i++) await task(p);
    const summary = await loadDashboardWorkSummary(owner);
    expect(summary.decisions.map((item) => item.id)).toEqual([m]);
    expect(summary.active).toHaveLength(WORK_SECTION_LIMIT);
    expect(summary.coverage.partial).toBe(true);
    expect(summary.coverage.totalCountAvailable).toBe(false);
  });

  it("shows only the latest execution of an explicit operation instead of a stale paused phase", async () => {
    const p = await project();
    const operationId = randomUUID();
    await execution(p, { operationId, status: "paused", createdAt: new Date("2026-02-01") });
    const latest = await execution(p, { operationId, status: "completed", createdAt: new Date("2026-02-02") });
    const summary = await loadDashboardWorkSummary(owner);
    expect(summary.decisions).toEqual([]);
    expect(summary.recent.map((item) => item.id)).toEqual([latest]);
    expect(summary.recent[0].stateBasis).toBe("recorded_only");
  });

  it("surfaces a current paused Goal execution on its Mission even before the Goal status catches up", async () => {
    const p = await project();
    const m = await mission(p);
    const g = await goal(p, m, "running");
    await execution(p, { goalId: g, status: "paused" });
    const summary = await loadDashboardWorkSummary(owner);
    expect(summary.decisions.map((item) => item.id)).toEqual([m]);
    expect(summary.active.some((item) => item.id === m)).toBe(false);
    expect(summary.decisions[0].stateBasis).toBe("recorded_only");
  });

  it("does not inherit a superseded paused Goal execution into Mission review", async () => {
    const p = await project();
    const m = await mission(p);
    const g = await goal(p, m, "running");
    await execution(p, { goalId: g, status: "paused", createdAt: new Date("2026-03-01") });
    await execution(p, { goalId: g, status: "completed", createdAt: new Date("2026-03-02") });
    const summary = await loadDashboardWorkSummary(owner);
    expect(summary.decisions).toEqual([]);
    expect(summary.active.map((item) => item.id)).toEqual([m]);
  });

  it("fails closed for unclassifiable or oversized execution envelopes", () => {
    expect(isProjectWorkRequest("{broken", "p")).toBe(false);
    expect(isProjectWorkRequest(JSON.stringify({ projectId: "other", turnIntent: "PROJECT_QUERY" }), "p")).toBe(false);
    expect(isProjectWorkRequest(JSON.stringify({ projectId: "p", turnIntent: "CHAT" }), "p")).toBe(false);
    expect(isProjectWorkRequest(" ".repeat(32_001), "p")).toBe(false);
  });
});
