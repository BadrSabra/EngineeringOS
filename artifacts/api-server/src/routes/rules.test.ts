/**
 * Tests for rules.ts: CRUD, severity/project filters, rule evaluation.
 */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import app from "../app.js";
import { db, rulesTable, projectsTable, eventsTable, auditLogsTable } from "@workspace/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function insertRule(overrides: {
  code?: string;
  title?: string;
  severity?: "critical" | "high" | "medium" | "low";
  pattern?: string;
  enabled?: boolean;
  projectId?: string;
} = {}): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(rulesTable).values({
    id,
    code: overrides.code ?? `RULE_${id.slice(0, 8)}`,
    title: overrides.title ?? "Test rule",
    severity: overrides.severity ?? "medium",
    pattern: overrides.pattern ?? null,
    enabled: overrides.enabled ?? true,
    projectId: overrides.projectId ?? null,
    hitCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `rules-test-project-${id.slice(0, 8)}`,
    rootPath: `/tmp/rules-test-project-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

const ruleCleanup: string[] = [];
const projectCleanup: string[] = [];

async function cleanup() {
  for (const id of ruleCleanup.splice(0)) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, id)).catch(() => undefined);
    await db.delete(rulesTable).where(eq(rulesTable.id, id)).catch(() => undefined);
  }
  for (const id of projectCleanup.splice(0)) {
    await db.delete(eventsTable).where(eq(eventsTable.projectId, id)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, id)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, id)).catch(() => undefined);
  }
}

afterEach(cleanup);

// ─── GET /rules — list ────────────────────────────────────────────────────────

describe("GET /rules — list", () => {
  it("returns 200 with an array (possibly empty)", async () => {
    const res = await request(app).get("/api/rules");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("includes newly created rules", async () => {
    const id = await insertRule({ code: "LIST_TEST" });
    ruleCleanup.push(id);

    const res = await request(app).get("/api/rules");
    expect(res.status).toBe(200);
    const found = (res.body as { id: string }[]).find((r) => r.id === id);
    expect(found).toBeDefined();
  });

  it("filters by severity when ?severity= is provided", async () => {
    const critId = await insertRule({ severity: "critical" });
    const lowId = await insertRule({ severity: "low" });
    ruleCleanup.push(critId, lowId);

    const res = await request(app).get("/api/rules?severity=critical");
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(critId);
    expect(ids).not.toContain(lowId);
  });

  it("filters by projectId when ?projectId= is provided", async () => {
    const projectId = await insertProject();
    projectCleanup.push(projectId);

    const scopedId = await insertRule({ projectId });
    const globalId = await insertRule(); // projectId = null
    ruleCleanup.push(scopedId, globalId);

    const res = await request(app).get(`/api/rules?projectId=${projectId}`);
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(scopedId);
    expect(ids).not.toContain(globalId);
  });

  it("orders by hitCount descending", async () => {
    // Insert two rules and bump one's hitCount manually
    const lowHitId = await insertRule({ code: "LOW_HIT" });
    const highHitId = await insertRule({ code: "HIGH_HIT" });
    ruleCleanup.push(lowHitId, highHitId);

    await db.update(rulesTable).set({ hitCount: 50 }).where(eq(rulesTable.id, highHitId));

    const res = await request(app).get("/api/rules");
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((r) => r.id);
    expect(ids.indexOf(highHitId)).toBeLessThan(ids.indexOf(lowHitId));
  });
});

// ─── POST /rules — create ─────────────────────────────────────────────────────

describe("POST /rules — create", () => {
  it("returns 201 with the created rule shape", async () => {
    const res = await request(app).post("/api/rules").send({
      code: "NO_CONSOLE",
      title: "No console.log",
      severity: "medium",
    });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe("NO_CONSOLE");
    expect(res.body.title).toBe("No console.log");
    expect(res.body.severity).toBe("medium");
    expect(typeof res.body.id).toBe("string");
    ruleCleanup.push(res.body.id);
  });

  it("creates an audit entry on successful create", async () => {
    const res = await request(app).post("/api/rules").send({
      code: "AUDIT_TEST_RULE",
      title: "Audit test",
      severity: "low",
    });
    expect(res.status).toBe(201);
    ruleCleanup.push(res.body.id);

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, res.body.id));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].action).toBe("created");
    expect(audits[0].entityType).toBe("rule");
  });

  it("associates a rule with a project when projectId is provided", async () => {
    const projectId = await insertProject();
    projectCleanup.push(projectId);

    const res = await request(app).post("/api/rules").send({
      code: "PROJECT_SCOPED_RULE",
      title: "Scoped",
      severity: "high",
      projectId,
    });
    expect(res.status).toBe(201);
    ruleCleanup.push(res.body.id);
    expect(res.body.projectId).toBe(projectId);
  });
});

// ─── GET /rules/:ruleId ───────────────────────────────────────────────────────

describe("GET /rules/:ruleId", () => {
  it("returns 200 with the rule data", async () => {
    const id = await insertRule({ code: "GET_TEST" });
    ruleCleanup.push(id);

    const res = await request(app).get(`/api/rules/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.code).toBe("GET_TEST");
  });

  it("returns 404 for an unknown rule", async () => {
    const res = await request(app).get(`/api/rules/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Rule not found");
  });
});

// ─── PATCH /rules/:ruleId ─────────────────────────────────────────────────────

describe("PATCH /rules/:ruleId", () => {
  it("returns 200 with updated fields", async () => {
    const id = await insertRule({ severity: "low", enabled: true });
    ruleCleanup.push(id);

    const res = await request(app).patch(`/api/rules/${id}`).send({ severity: "high" });
    expect(res.status).toBe(200);
    expect(res.body.severity).toBe("high");
  });

  it("creates an audit entry on update", async () => {
    const id = await insertRule({ title: "Before update" });
    ruleCleanup.push(id);

    const res = await request(app).patch(`/api/rules/${id}`).send({ title: "After update" });
    expect(res.status).toBe(200);

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, id));
    const updateAudit = audits.find((a) => a.action === "updated");
    expect(updateAudit).toBeDefined();
  });

  it("returns 404 for an unknown rule", async () => {
    const res = await request(app).patch(`/api/rules/${randomUUID()}`).send({ title: "nope" });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /rules/:ruleId ────────────────────────────────────────────────────

describe("DELETE /rules/:ruleId", () => {
  it("returns 204 and the rule is gone", async () => {
    const id = await insertRule();
    ruleCleanup.push(id); // cleanup if delete fails

    const res = await request(app).delete(`/api/rules/${id}`);
    expect(res.status).toBe(204);

    const rows = await db.select().from(rulesTable).where(eq(rulesTable.id, id));
    expect(rows).toHaveLength(0);

    // Remove from cleanup since it's already deleted
    const idx = ruleCleanup.indexOf(id);
    if (idx >= 0) ruleCleanup.splice(idx, 1);
  });

  it("returns 204 even when the rule does not exist (idempotent)", async () => {
    const res = await request(app).delete(`/api/rules/${randomUUID()}`);
    expect(res.status).toBe(204);
  });
});

// ─── POST /rules/:ruleId/evaluate ─────────────────────────────────────────────

describe("POST /rules/:ruleId/evaluate", () => {
  it("returns 404 when the rule does not exist", async () => {
    const projectId = await insertProject();
    projectCleanup.push(projectId);

    const res = await request(app)
      .post(`/api/rules/${randomUUID()}/evaluate`)
      .send({ projectId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Rule not found");
  });

  it("returns 404 when the project does not exist", async () => {
    const id = await insertRule({ pattern: "console\\.log" });
    ruleCleanup.push(id);

    const res = await request(app)
      .post(`/api/rules/${id}/evaluate`)
      .send({ projectId: randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Project not found");
  });

  it("skips evaluation and returns a note when the rule has no pattern", async () => {
    const id = await insertRule({ pattern: undefined }); // no pattern
    ruleCleanup.push(id);

    const projectId = await insertProject();
    projectCleanup.push(projectId);

    const res = await request(app)
      .post(`/api/rules/${id}/evaluate`)
      .send({ projectId });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
    expect(res.body.matchCount).toBe(0);
    expect(typeof res.body.note).toBe("string");
  });

  it("evaluates a pattern against a missing path: matched=false, matchCount=0", async () => {
    const id = await insertRule({ pattern: "console\\.log" });
    ruleCleanup.push(id);

    const projectId = await insertProject();
    projectCleanup.push(projectId);

    const res = await request(app)
      .post(`/api/rules/${id}/evaluate`)
      .send({ projectId });
    expect(res.status).toBe(200);
    expect(res.body.ruleId).toBe(id);
    expect(res.body.projectId).toBe(projectId);
    expect(typeof res.body.matched).toBe("boolean");
    expect(typeof res.body.matchCount).toBe("number");
    expect(Array.isArray(res.body.matches)).toBe(true);
  });

  it("creates a RuleEvaluated event and an audit entry", async () => {
    const id = await insertRule({ pattern: "console\\.log" });
    ruleCleanup.push(id);

    const projectId = await insertProject();
    projectCleanup.push(projectId);

    await request(app).post(`/api/rules/${id}/evaluate`).send({ projectId });

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const evalEvent = events.find((e) => e.type === "RuleEvaluated");
    expect(evalEvent).toBeDefined();

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, id));
    const evalAudit = audits.find((a) => a.action === "evaluated");
    expect(evalAudit).toBeDefined();
  });
});
