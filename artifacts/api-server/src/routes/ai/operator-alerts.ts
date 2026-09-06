import { Router } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, operatorAlertsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireProjectAccess } from "../../middlewares/requireProjectAccess.js";
import { z } from "zod";
import {
  getAiProjectBudgetSummary,
  updateAiProjectBudget,
  validateAiBudgetInput,
} from "../../lib/ai-budget.js";

const router = Router();
router.use(requireAuth);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Deployment-wide operator alerts. Responses contain only safe operational
 * metadata and never provider credentials or raw provider responses.
 */
router.get("/ai/operator-alerts", async (req, res) => {
  const rawLimit = req.query.limit === undefined ? DEFAULT_LIMIT : Number(req.query.limit);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) {
    return res.status(400).json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` });
  }

  const rawActiveOnly = req.query.activeOnly;
  const activeOnly = rawActiveOnly === undefined || rawActiveOnly === "true";
  if (rawActiveOnly !== undefined && rawActiveOnly !== "true" && rawActiveOnly !== "false") {
    return res.status(400).json({ error: "activeOnly must be true or false" });
  }

  const alerts = await db
    .select()
    .from(operatorAlertsTable)
    .where(and(
      activeOnly
        ? inArray(operatorAlertsTable.status, ["open", "acknowledged"])
        : undefined,
      or(isNull(operatorAlertsTable.ownerId), eq(operatorAlertsTable.ownerId, req.userId)),
    ))
    .orderBy(desc(operatorAlertsTable.lastSeenAt), desc(operatorAlertsTable.id))
    .limit(rawLimit);

  return res.json({ alerts });
});

const budgetInputSchema = z.object({
  dailyAttemptLimit: z.number().int(),
  dailyTokenLimit: z.number().int(),
  warningThreshold: z.number(),
}).strict();

/**
 * Project-owner budget controls. Project ownership is established by the
 * middleware; ownerId is never accepted from client input.
 */
router.get("/ai/projects/:projectId/budget", requireProjectAccess, async (req, res) => {
  if (!req.project) return;
  const projectId = req.params.projectId as string;
  return res.json(await getAiProjectBudgetSummary({
    ownerId: req.userId,
    projectId,
  }));
});

router.put("/ai/projects/:projectId/budget", requireProjectAccess, async (req, res) => {
  if (!req.project) return;
  const projectId = req.params.projectId as string;
  const parsed = budgetInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid AI budget settings.",
      code: "INVALID_AI_BUDGET",
      details: parsed.error.issues.map((issue) => issue.path.join(".")).slice(0, 8),
    });
  }
  const validationError = validateAiBudgetInput(parsed.data);
  if (validationError) {
    return res.status(400).json({ error: validationError, code: "INVALID_AI_BUDGET" });
  }
  return res.json(await updateAiProjectBudget({
    ownerId: req.userId,
    projectId,
    ...parsed.data,
  }));
});

router.patch("/ai/projects/:projectId/budget/alerts/:alertId",
  requireProjectAccess,
  async (req, res) => {
    if (!req.project) return;
    const projectId = req.params.projectId as string;
    const alertId = req.params.alertId as string;
    const action = z.object({ action: z.enum(["acknowledge", "resolve"]) }).strict().safeParse(req.body);
    if (!action.success) {
      return res.status(400).json({ error: "action must be acknowledge or resolve", code: "INVALID_ALERT_ACTION" });
    }
    const [alert] = await db.select().from(operatorAlertsTable).where(and(
      eq(operatorAlertsTable.id, alertId),
      eq(operatorAlertsTable.ownerId, req.userId),
      eq(operatorAlertsTable.projectId, projectId),
    )).limit(1);
    if (!alert) return res.status(404).json({ error: "Budget alert not found" });
    const now = new Date();
    const nextStatus = action.data.action === "acknowledge" ? "acknowledged" : "resolved";
    const [updated] = await db.update(operatorAlertsTable)
      .set({ status: nextStatus, resolvedAt: nextStatus === "resolved" ? now : null })
      .where(and(
        eq(operatorAlertsTable.id, alert.id),
        eq(operatorAlertsTable.ownerId, req.userId),
        eq(operatorAlertsTable.projectId, projectId),
      ))
      .returning();
    return res.json({ alert: updated });
  },
);

router.get("/ai/projects/:projectId/budget/alerts", requireProjectAccess, async (req, res) => {
  if (!req.project) return;
  const projectId = req.params.projectId as string;
  const activeOnly = req.query.activeOnly !== "false";
  const alerts = await db.select().from(operatorAlertsTable).where(and(
    eq(operatorAlertsTable.ownerId, req.userId),
    eq(operatorAlertsTable.projectId, projectId),
    activeOnly ? inArray(operatorAlertsTable.status, ["open", "acknowledged"]) : undefined,
  )).orderBy(desc(operatorAlertsTable.lastSeenAt), desc(operatorAlertsTable.id)).limit(100);
  return res.json({ alerts });
});

export default router;