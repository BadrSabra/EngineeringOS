/**
 * Tests for dashboard.ts: GET /dashboard aggregated summary.
 *
 * All requests in these tests hit the route as "test-user" (the synthetic
 * identity injected by requireAuth's NODE_ENV=test bypass). Isolation tests
 * insert rows owned by a different user ("other-user") and verify they are
 * invisible in the response, proving the owner-scoping contract.
 */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import app from "../app.js";
import {
  db,
  projectsTable,
  tasksTable,
  eventsTable,
  rulesTable,
  metricsTable,
} from "@workspace/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_USER = "test-user";
const OTHER_USER = "other-user";

async function insertProject(
  ownerId: string = TEST_USER,
  qualityScore?: number,
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId,
    name: `dashboard-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/dashboard-test-${id}`,
    language: "typescript",
    status: "active",
    qualityScore: qualityScore ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertTask(projectId: string, status: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(tasksTable).values({
    id,
    projectId,
    title: `Task ${id.slice(0, 6)}`,
    status: status as "pending",
    priority: "p2",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertEvent(projectId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(eventsTable).values({
    id,
    projectId,
    type: "test.event",
    payload: {},
    timestamp: new Date(),
  });
  return id;
}

async function insertMetric(
  projectId: string,
  overallScore: number,
  timestampOffset = 0,
): Promise<string> {
  const id = randomUUID();
  await db.insert(metricsTable).values({
    id,
    projectId,
    timestamp: new Date(Date.now() + timestampOffset),
    overallScore,
    securityScore: overallScore,
    maintainabilityScore: overallScore,
    reliabilityScore: overallScore,
    performanceScore: overallScore,
    lintIssues: 0,
    buildStatus: "unknown",
  });
  return id;
}

async function insertRule(hitCount: number, projectId?: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(rulesTable).values({
    id,
    projectId: projectId ?? null,
    code: `DASH_RULE_${id.slice(0, 6)}`,
    title: "Dashboard test rule",
    severity: "medium",
    hitCount,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// Tracked IDs for cleanup in afterEach
const projectIds: string[] = [];
const ruleIds: string[] = [];

afterEach(async () => {
  for (const pid of projectIds.splice(0)) {
    await db.delete(metricsTable).where(eq(metricsTable.projectId, pid)).catch(() => undefined);
    await db.delete(tasksTable).where(eq(tasksTable.projectId, pid)).catch(() => undefined);
    await db.delete(eventsTable).where(eq(eventsTable.projectId, pid)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, pid)).catch(() => undefined);
  }
  for (const id of ruleIds.splice(0)) {
    await db.delete(rulesTable).where(eq(rulesTable.id, id)).catch(() => undefined);
  }
});

// ─── GET /dashboard — shape ────────────────────────────────────────────────────

describe("GET /dashboard", () => {
  it("returns 200 with all required top-level fields", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("projectCount");
    expect(res.body).toHaveProperty("activeTaskCount");
    expect(res.body).toHaveProperty("completedTaskCount");
    expect(res.body).toHaveProperty("failedTaskCount");
    expect(res.body).toHaveProperty("recentEvents");
    expect(res.body).toHaveProperty("projectScores");
    expect(res.body).toHaveProperty("taskStatusBreakdown");
    expect(res.body).toHaveProperty("topRules");
    expect(typeof res.body.projectCount).toBe("number");
    expect(Array.isArray(res.body.recentEvents)).toBe(true);
    expect(Array.isArray(res.body.projectScores)).toBe(true);
    expect(Array.isArray(res.body.topRules)).toBe(true);
  });

  // ─── projectCount ───────────────────────────────────────────────────────────

  it("projectCount reflects only the calling user's projects", async () => {
    const baseline = (await request(app).get("/api/dashboard")).body.projectCount as number;

    const pid1 = await insertProject(TEST_USER);
    const pid2 = await insertProject(TEST_USER);
    projectIds.push(pid1, pid2);

    const res = await request(app).get("/api/dashboard");
    expect(res.body.projectCount).toBe(baseline + 2);
  });

  // ─── task counts ────────────────────────────────────────────────────────────

  it("activeTaskCount counts running, verifying, and queued tasks", async () => {
    const pid = await insertProject();
    projectIds.push(pid);

    const baseline = (await request(app).get("/api/dashboard")).body.activeTaskCount as number;

    await insertTask(pid, "running");
    await insertTask(pid, "verifying");
    await insertTask(pid, "queued");
    await insertTask(pid, "completed"); // should NOT count
    await insertTask(pid, "failed"); // should NOT count

    const res = await request(app).get("/api/dashboard");
    expect(res.body.activeTaskCount).toBe(baseline + 3);
  });

  it("completedTaskCount counts only completed tasks", async () => {
    const pid = await insertProject();
    projectIds.push(pid);

    const baseline = (await request(app).get("/api/dashboard")).body.completedTaskCount as number;

    await insertTask(pid, "completed");
    await insertTask(pid, "completed");
    await insertTask(pid, "failed"); // should NOT count

    const res = await request(app).get("/api/dashboard");
    expect(res.body.completedTaskCount).toBe(baseline + 2);
  });

  it("taskStatusBreakdown groups tasks by status", async () => {
    const pid = await insertProject();
    projectIds.push(pid);

    await insertTask(pid, "pending");
    await insertTask(pid, "pending");
    await insertTask(pid, "running");

    const res = await request(app).get("/api/dashboard");
    expect(typeof res.body.taskStatusBreakdown).toBe("object");
    expect(res.body.taskStatusBreakdown.pending).toBeGreaterThanOrEqual(2);
    expect(res.body.taskStatusBreakdown.running).toBeGreaterThanOrEqual(1);
  });

  // ─── events ─────────────────────────────────────────────────────────────────

  it("recentEvents is capped at 20 entries", async () => {
    const res = await request(app).get("/api/dashboard");
    expect((res.body.recentEvents as unknown[]).length).toBeLessThanOrEqual(20);
  });

  // ─── rules ──────────────────────────────────────────────────────────────────

  it("topRules is capped at 5 entries", async () => {
    const res = await request(app).get("/api/dashboard");
    expect((res.body.topRules as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it("global rules (no projectId) appear in topRules for any authenticated user", async () => {
    const ruleId = await insertRule(99); // null projectId → global rule
    ruleIds.push(ruleId);

    const res = await request(app).get("/api/dashboard");
    const rule = (
      res.body.topRules as { ruleId: string; code: string; title: string; hitCount: number }[]
    ).find((r) => r.ruleId === ruleId);
    expect(rule).toBeDefined();
    expect(rule?.hitCount).toBe(99);
    expect(typeof rule?.code).toBe("string");
    expect(typeof rule?.title).toBe("string");
  });

  // ─── projectScores / metric trends ──────────────────────────────────────────

  it("projectScores trend is 'improving' when latest score > previous by >2", async () => {
    const pid = await insertProject();
    projectIds.push(pid);

    await insertMetric(pid, 50, -10_000); // older
    await insertMetric(pid, 80, 0);       // newer

    const res = await request(app).get("/api/dashboard");
    const scoreEntry = (
      res.body.projectScores as { projectId: string; trend: string }[]
    ).find((s) => s.projectId === pid);
    expect(scoreEntry).toBeDefined();
    expect(scoreEntry?.trend).toBe("improving");
  });

  it("projectScores trend is 'declining' when latest score < previous by >2", async () => {
    const pid = await insertProject();
    projectIds.push(pid);

    await insertMetric(pid, 80, -10_000); // older
    await insertMetric(pid, 50, 0);       // newer

    const res = await request(app).get("/api/dashboard");
    const scoreEntry = (
      res.body.projectScores as { projectId: string; trend: string }[]
    ).find((s) => s.projectId === pid);
    expect(scoreEntry).toBeDefined();
    expect(scoreEntry?.trend).toBe("declining");
  });

  it("projectScores trend is 'stable' when there is only one metric row", async () => {
    const pid = await insertProject();
    projectIds.push(pid);

    await insertMetric(pid, 70);

    const res = await request(app).get("/api/dashboard");
    const scoreEntry = (
      res.body.projectScores as { projectId: string; trend: string }[]
    ).find((s) => s.projectId === pid);
    expect(scoreEntry).toBeDefined();
    expect(scoreEntry?.trend).toBe("stable");
  });

  it("projectScores each entry has projectId, projectName, score, trend", async () => {
    const pid = await insertProject(TEST_USER, 75);
    projectIds.push(pid);

    const res = await request(app).get("/api/dashboard");
    const entry = (
      res.body.projectScores as {
        projectId: string;
        projectName: string;
        score: number;
        trend: string;
      }[]
    ).find((s) => s.projectId === pid);
    expect(entry).toBeDefined();
    expect(typeof entry?.projectName).toBe("string");
    expect(typeof entry?.score).toBe("number");
    expect(["improving", "stable", "declining"]).toContain(entry?.trend);
  });

  // ─── Ownership isolation ────────────────────────────────────────────────────
  // These tests prove the scoping contract: the calling user ("test-user")
  // cannot see data owned by a different user ("other-user") through any
  // field in the dashboard response.

  it("projectCount does not include projects owned by another user", async () => {
    const baseline = (await request(app).get("/api/dashboard")).body.projectCount as number;

    const myPid = await insertProject(TEST_USER);
    const theirPid = await insertProject(OTHER_USER);
    projectIds.push(myPid, theirPid);

    const res = await request(app).get("/api/dashboard");
    // Only the calling user's project increments the count.
    expect(res.body.projectCount).toBe(baseline + 1);
  });

  it("projectScores does not include entries for another user's projects", async () => {
    const theirPid = await insertProject(OTHER_USER);
    projectIds.push(theirPid);

    const res = await request(app).get("/api/dashboard");
    const leaked = (
      res.body.projectScores as { projectId: string }[]
    ).find((s) => s.projectId === theirPid);
    expect(leaked).toBeUndefined();
  });

  it("task counts do not include tasks from another user's projects", async () => {
    const theirPid = await insertProject(OTHER_USER);
    projectIds.push(theirPid);

    const baseline = (await request(app).get("/api/dashboard")).body.activeTaskCount as number;

    // Tasks in another user's project — must not affect the caller's counts.
    await insertTask(theirPid, "running");
    await insertTask(theirPid, "running");

    const res = await request(app).get("/api/dashboard");
    expect(res.body.activeTaskCount).toBe(baseline);
  });

  it("recentEvents does not include events from another user's projects", async () => {
    const theirPid = await insertProject(OTHER_USER);
    projectIds.push(theirPid);

    await insertEvent(theirPid);

    const res = await request(app).get("/api/dashboard");
    const leaked = (
      res.body.recentEvents as { projectId: string }[]
    ).find((e) => e.projectId === theirPid);
    expect(leaked).toBeUndefined();
  });

  it("projectScores metric trend is not influenced by another user's metrics", async () => {
    const myPid = await insertProject(TEST_USER);
    const theirPid = await insertProject(OTHER_USER);
    projectIds.push(myPid, theirPid);

    // Give our project a stable single metric (score = 70).
    await insertMetric(myPid, 70);
    // Give the other user's project two metrics that would show "improving"
    // if they were mistakenly included in our project's trend calculation.
    await insertMetric(theirPid, 30, -10_000);
    await insertMetric(theirPid, 90, 0);

    const res = await request(app).get("/api/dashboard");
    const myEntry = (
      res.body.projectScores as { projectId: string; trend: string }[]
    ).find((s) => s.projectId === myPid);
    // Our project has only one metric, so trend must be "stable", not
    // "improving" (which would indicate the other user's metrics leaked in).
    expect(myEntry).toBeDefined();
    expect(myEntry?.trend).toBe("stable");
  });

  it("project-specific rules from another user's projects are not shown", async () => {
    const theirPid = await insertProject(OTHER_USER);
    projectIds.push(theirPid);

    // A rule explicitly tied to the other user's project.
    const theirRuleId = await insertRule(999, theirPid);
    ruleIds.push(theirRuleId);

    const res = await request(app).get("/api/dashboard");
    const leaked = (
      res.body.topRules as { ruleId: string }[]
    ).find((r) => r.ruleId === theirRuleId);
    expect(leaked).toBeUndefined();
  });
});
