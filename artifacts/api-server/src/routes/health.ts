import { Router, type IRouter } from "express";
import { GetHealthResponse } from "@workspace/api-zod";
import { heavyJobQueue } from "../lib/job-queue.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = GetHealthResponse.parse({
    status: "ok",
    jobQueue: heavyJobQueue.getStats(),
  });
  res.json(data);
});

export default router;
