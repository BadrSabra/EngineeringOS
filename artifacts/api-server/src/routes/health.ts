import { Router, type IRouter } from "express";
import { GetHealthResponse } from "@workspace/api-zod";
import { heavyJobQueue } from "../lib/job-queue.js";
import { getOperationalCounters } from "../lib/operational-counters.js";
import { getAiDiagnosticsRetentionHealth } from "../lib/startup-migrations.js";
import { getStartupMaintenanceReadiness } from "../lib/startup-migrations.js";
import { getApplicationSchemaReadiness } from "../lib/schema-readiness.js";
import { getTaskExecutionRetentionHealth } from "../lib/task-execution-retention.js";
import { getDurableJobHealth } from "../lib/job-reconciliation.js";
import { loadLatestAgentEpisodeShadowCampaignScorecard } from "../lib/agent-state/agent-episode-shadow-campaign.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * Readiness is deliberately separate from liveness. A process can be
 * listening while the database schema is from an older build; release
 * validation must receive a bounded, actionable blocked result instead of
 * treating that listener as ready for authenticated work.
 */
router.get("/readiness", async (_req, res) => {
  const [schema, maintenance] = await Promise.all([
    getApplicationSchemaReadiness(),
    getStartupMaintenanceReadiness(),
  ]);
  const isReady = schema.status === "ready" && maintenance.status === "ready";
  const schemaUnavailable =
    schema.status === "blocked" && schema.reason === "schema_unavailable";
  return res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "blocked",
    checks: {
      api: { status: "ready" },
      database: {
        status: schemaUnavailable ? "blocked" : "ready",
        ...(schemaUnavailable ? { reason: "database_unavailable" } : {}),
      },
      schema: schema.status === "ready"
        ? { status: "ready", checkedAt: schema.checkedAt }
        : {
            status: "blocked",
            reason: schema.reason,
            ...(schema.issueCount === undefined ? {} : { issueCount: schema.issueCount }),
            checkedAt: schema.checkedAt,
          },
      maintenance,
    },
  });
});

router.get("/healthz", async (_req, res) => {
  let durableShadowCampaign = null;
  try {
    durableShadowCampaign = await loadLatestAgentEpisodeShadowCampaignScorecard() ?? null;
  } catch (error) {
    logger.warn(
      { scope: "healthz", code: "shadow_campaign_scorecard_unavailable", error },
      "Shadow campaign scorecard could not be loaded",
    );
  }
  const data = GetHealthResponse.parse({
    status: "ok",
    jobQueue: heavyJobQueue.getStats(),
    // Surface operational counters so operators can see degraded subsystems
    // and whether failed audit writes are still awaiting recovery.
    operationalCounters: {
      ...getOperationalCounters(),
      agentEpisodeShadow: {
        ...getOperationalCounters().agentEpisodeShadow,
        durableScorecard: durableShadowCampaign,
      },
    },
    aiDiagnosticsRetention: getAiDiagnosticsRetentionHealth(),
    taskExecutionRetention: getTaskExecutionRetentionHealth(),
    jobRecovery: await getDurableJobHealth(),
  });
  res.json(data);
});

export default router;
