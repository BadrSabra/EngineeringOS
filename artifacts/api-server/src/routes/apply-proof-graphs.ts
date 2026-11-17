import { Router } from "express";
import { db } from "@workspace/db";
import { requireProjectAccess } from "../middlewares/requireProjectAccess.js";
import { projectApplyChangesProofGraph } from "../lib/apply-changes-proof-graph-projector.js";

const router = Router();

router.get(
  "/projects/:projectId/executions/:executionId/apply-proof-graph/attempts/:attempt",
  requireProjectAccess,
  async (req, res) => {
    const executionId = req.params.executionId;
    const attemptValue = req.params.attempt;
    if (
      typeof executionId !== "string"
      || !executionId.trim()
      || typeof attemptValue !== "string"
      || !/^(0|[1-9]\d*)$/u.test(attemptValue)
      || !Number.isSafeInteger(Number(attemptValue))
    ) {
      return res.status(400).json({
        error: "A non-negative Apply execution attempt is required.",
        code: "APPLY_PROOF_GRAPH_ATTEMPT_INVALID",
      });
    }
    if (!req.project || !req.userId) {
      return res.status(401).json({
        error: "Project owner context is unavailable.",
        code: "APPLY_PROOF_GRAPH_AUTH_REQUIRED",
      });
    }

    try {
      const result = await db.transaction(
        (tx) => projectApplyChangesProofGraph(tx, {
          projectId: req.project!.id,
          executionId,
          expectedAttempt: Number(attemptValue),
          userId: req.userId!,
        }),
        { isolationLevel: "repeatable read" },
      );
      return res.json(result);
    } catch {
      return res.status(503).json({
        error: "The Apply proof projection could not be completed consistently.",
        code: "APPLY_PROOF_GRAPH_READ_FAILED",
        retryable: true,
      });
    }
  },
);

export default router;
