import { Router, type IRouter } from "express";
import { GetHealthResponse } from "@workspace/api-zod";
import { heavyJobQueue } from "../lib/job-queue.js";
import { getOperationalCounters } from "../lib/operational-counters.js";
import { getAiDiagnosticsRetentionHealth } from "../lib/startup-migrations.js";
import { getTaskExecutionRetentionHealth } from "../lib/task-execution-retention.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = GetHealthResponse.parse({
    status: "ok",
    jobQueue: heavyJobQueue.getStats(),
    // Surface operational counters so operators can see degraded subsystems
    // and whether failed audit writes are still awaiting recovery.
    operationalCounters: getOperationalCounters(),
    aiDiagnosticsRetention: getAiDiagnosticsRetentionHealth(),
    taskExecutionRetention: getTaskExecutionRetentionHealth(),
  });
  res.json(data);
});

export default router;
