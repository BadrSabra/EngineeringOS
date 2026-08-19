import { Router, type IRouter } from "express";
import { GetHealthResponse } from "@workspace/api-zod";
import { heavyJobQueue } from "../lib/job-queue.js";
import { getOperationalCounters } from "../lib/operational-counters.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = GetHealthResponse.parse({
    status: "ok",
    jobQueue: heavyJobQueue.getStats(),
    // PR-2: surface in-process operational counters so operators can detect
    // degraded audit / rate-limiter subsystems without tailing logs.
    operationalCounters: getOperationalCounters(),
  });
  res.json(data);
});

export default router;
