import { Router } from "express";
import { db } from "@workspace/db";
import { rulesTable, eventsTable, projectsTable } from "@workspace/db";
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
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { walkProject, matchRule, type RuleInput } from "@workspace/scanner";

const router = Router();

// List rules
router.get("/rules", async (req, res) => {
  const params = ListRulesQueryParams.parse(req.query);
  const conditions = [];
  if (params.projectId)
    conditions.push(eq(rulesTable.projectId, params.projectId));
  if (params.severity) conditions.push(eq(rulesTable.severity, params.severity));

  const rules =
    conditions.length > 0
      ? await db
          .select()
          .from(rulesTable)
          .where(and(...conditions))
          .orderBy(desc(rulesTable.hitCount))
      : await db.select().from(rulesTable).orderBy(desc(rulesTable.hitCount));
  return res.json(rules);
});

// Create rule
router.post("/rules", async (req, res) => {
  const body = CreateRuleBody.parse(req.body);
  const now = new Date();
  const rule = await db
    .insert(rulesTable)
    .values({ id: randomUUID(), ...body, createdAt: now, updatedAt: now })
    .returning();
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
  return res.json(rule[0]);
});

// Update rule
router.patch("/rules/:ruleId", async (req, res) => {
  const { ruleId } = UpdateRuleParams.parse(req.params);
  const body = UpdateRuleBody.parse(req.body);
  const updated = await db
    .update(rulesTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(rulesTable.id, ruleId))
    .returning();
  if (!updated[0]) return res.status(404).json({ error: "Rule not found" });
  return res.json(updated[0]);
});

// Delete rule
router.delete("/rules/:ruleId", async (req, res) => {
  const { ruleId } = DeleteRuleParams.parse(req.params);
  await db.delete(rulesTable).where(eq(rulesTable.id, ruleId));
  return res.status(204).send();
});

// Evaluate rule against a project — real regex matching against actual files
router.post("/rules/:ruleId/evaluate", async (req, res) => {
  const { ruleId } = EvaluateRuleParams.parse(req.params);
  const body = EvaluateRuleBody.parse(req.body);

  const [rule, project] = await Promise.all([
    db.select().from(rulesTable).where(eq(rulesTable.id, ruleId)).limit(1),
    db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, body.projectId))
      .limit(1),
  ]);

  if (!rule[0]) return res.status(404).json({ error: "Rule not found" });
  if (!project[0]) return res.status(404).json({ error: "Project not found" });

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

  const { files } = await walkProject(project[0].rootPath);

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
