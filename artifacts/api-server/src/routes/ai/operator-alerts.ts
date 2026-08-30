import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, operatorAlertsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth.js";

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
    .where(activeOnly ? eq(operatorAlertsTable.status, "open") : undefined)
    .orderBy(desc(operatorAlertsTable.lastSeenAt), desc(operatorAlertsTable.id))
    .limit(rawLimit);

  return res.json({ alerts });
});

export default router;