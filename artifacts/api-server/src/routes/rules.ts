import { Router } from "express";
import { db } from "@workspace/db";
import { rulesTable, eventsTable } from "@workspace/db";
import {
  CreateRuleBody,
  UpdateRuleBody,
  UpdateRuleParams,
  DeleteRuleParams,
  GetRuleParams,
  EvaluateRuleParams,
  EvaluateRuleBody,
  ListRulesQueryParams,
} from "@workspace/api-zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";
import { walkProject, matchRule, type RuleInput } from "@workspace/scanner";
import { recordAudit } from "../lib/audit.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

// List rules
router.get("/rules", async (req, res) => {
  const params = ListRulesQueryParams.parse(req.query);
  const conditions = [];
  if (params.projectId) {
    const project = await loadProjectByIdForUser(params.projectId, req.userId, res);
    if (!project) return;
    conditions.push(eq(rulesTable.projectId, project.id));
  } else {
    conditions.push(isNull(rulesTable.projectId));
  }
  if (params.severity) conditions.push(eq(rulesTable.severity, params.severity));

  const rules = await db
    .select()
    .from(rulesTable)
    .where(and(...conditions))
    .orderBy(desc(rulesTable.hitCount));
  return res.json(rules);
});

// Create rule
router.post("/rules", async (req, res) => {
  const body = CreateRuleBody.parse(req.body);
  if (body.projectId) {
    const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
    if (!project) return;
  }
  const now = new Date();
  const rule = await db
    .insert(rulesTable)
    .values({ id: randomUUID(), ...body, createdAt: now, updatedAt: now })
    .returning();

  await recordAudit({
    entityType: "rule",
    entityId: rule[0].id,
    action: "created",
    projectId: body.projectId ?? null,
    stateAfter: rule[0],
    actor: req.userId,
    correlationId: randomUUID(),
  });

  return res.status(201).json(rule[0]);
});

// Get rule
router.get("/rules/:ruleId", async (req, res) => {
  const { ruleId } = GetRuleParams.parse(req.params);
  const rule = await db
    .select()
    .from(rulesTable)
    .where(eq(rulesTable.id, ruleId))
    .limit(1);
  if (!rule[0]) return res.status(404).json({ error: "Rule not found" });
  if (rule[0].projectId) {
    const project = await loadProjectByIdForUser(rule[0].projectId, req.userId, res);
    if (!project) return;
  }
  return res.json(rule[0]);
});

// Update rule
router.patch("/rules/:ruleId", async (req, res) => {
  const { ruleId } = UpdateRuleParams.parse(req.params);
  const body = UpdateRuleBody.parse(req.body);

  const before = await db.select().from(rulesTable).where(eq(rulesTable.id, ruleId)).limit(1);
  if (!before[0]) return res.status(404).json({ error: "Rule not found" });

  if (before[0].projectId) {
    const project = await loadProjectByIdForUser(before[0].projectId, req.userId, res);
    if (!project) return;
  }

  const updated = await db
    .update(rulesTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(rulesTable.id, ruleId))
    .returning();
  if (!updated[0]) return res.status(404).json({ error: "Rule not found" });

  await recordAudit({
    entityType: "rule",
    entityId: ruleId,
    action: "updated",
    projectId: before[0].projectId ?? null,
    changedFields: body,
    stateBefore: before[0],
    stateAfter: updated[0],
    actor: req.userId,
    correlationId: randomUUID(),
  });

  return res.json(updated[0]);
});

// Delete rule
router.delete("/rules/:ruleId", async (req, res) => {
  const { ruleId } = DeleteRuleParams.parse(req.params);

  const before = await db.select().from(rulesTable).where(eq(rulesTable.id, ruleId)).limit(1);
  // Idempotent DELETE: if the rule is already gone the desired state is achieved.
  if (!before[0]) return res.status(204).send();

  if (before[0].projectId) {
    const project = await loadProjectByIdForUser(before[0].projectId, req.userId, res);
    if (!project) return;
  }

  await db.delete(rulesTable).where(eq(rulesTable.id, ruleId));

  await recordAudit({
    entityType: "rule",
    entityId: ruleId,
    action: "deleted",
    projectId: before[0].projectId ?? null,
    stateBefore: before[0],
    actor: req.userId,
  });

  return res.status(204).send();
});

// Evaluate rule against a project — real regex matching against actual files
router.post("/rules/:ruleId/evaluate", async (req, res) => {
  const { ruleId } = EvaluateRuleParams.parse(req.params);
  const body = EvaluateRuleBody.parse(req.body);

  const rule = await db.select().from(rulesTable).where(eq(rulesTable.id, ruleId)).limit(1);
  if (!rule[0]) return res.status(404).json({ error: "Rule not found" });

  // Use the same ownership-check helper as every other route rather than an
  // inline ownerId comparison — consistent 400/404/403 semantics and a
  // single place to update if ownership logic ever changes.
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;

  if (!rule[0].pattern) {
    return res.json({
      ruleId,
      projectId: body.projectId,
      matched: false,
      matchCount: 0,
      matches: [],
      note: "Rule has no pattern — evaluation skipped",
    });
  }

  const { files } = await walkProject(project.rootPath);

  const ruleInput: RuleInput = {
    id: rule[0].id,
    code: rule[0].code,
    pattern: rule[0].pattern,
    severity: rule[0].severity,
    enabled: rule[0].enabled ?? true,
  };

  const result = matchRule(ruleInput, files);

  await db
    .update(rulesTable)
    .set({
      hitCount: (rule[0].hitCount ?? 0) + result.matchCount,
      updatedAt: new Date(),
    })
    .where(eq(rulesTable.id, ruleId));

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "RuleEvaluated",
    projectId: body.projectId,
    severity: result.matched ? "warning" : "info",
    message: `Rule "${rule[0].code}" evaluated: ${result.matchCount} matches`,
  });

  await recordAudit({
    entityType: "rule",
    entityId: ruleId,
    action: "evaluated",
    projectId: body.projectId,
    stateBefore: { hitCount: rule[0].hitCount ?? 0 },
    stateAfter: { hitCount: (rule[0].hitCount ?? 0) + result.matchCount },
    changedFields: { matchCount: result.matchCount, matched: result.matched },
  });

  return res.json({
    ruleId,
    projectId: body.projectId,
    matched: result.matched,
    matchCount: result.matchCount,
    matches: result.matches.map((m) => ({
      file: m.file,
      line: m.line,
      snippet: m.snippet,
    })),
  });
});

export default router;
