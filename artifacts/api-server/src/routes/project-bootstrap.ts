import { Router } from "express";
import {
  GetProjectBootstrapParams,
  StartProjectBootstrapBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  createProjectBootstrapJob,
  getOwnedProjectBootstrapJob,
  ProjectBootstrapIdempotencyConflict,
  toProjectBootstrapOperation,
} from "../lib/project-bootstrap.js";

const router = Router();
router.use(requireAuth);

router.post("/projects/bootstrap", async (req, res) => {
  const parsed = StartProjectBootstrapBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid project creation request.",
      code: "INVALID_BOOTSTRAP_REQUEST",
    });
  }
  try {
    const job = await createProjectBootstrapJob({
      ownerId: req.userId!,
      ...parsed.data,
    });
    return res.status(202).json(toProjectBootstrapOperation(job));
  } catch (error) {
    if (error instanceof ProjectBootstrapIdempotencyConflict) {
      return res.status(409).json({
        error: error.message,
        code: "IDEMPOTENCY_KEY_REUSED",
      });
    }
    throw error;
  }
});

router.get("/projects/bootstrap/:bootstrapId", async (req, res) => {
  const parsed = GetProjectBootstrapParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid project creation operation ID.",
      code: "INVALID_BOOTSTRAP_ID",
    });
  }
  const job = await getOwnedProjectBootstrapJob(req.userId!, parsed.data.bootstrapId);
  if (!job) {
    return res.status(404).json({ error: "Project creation operation not found." });
  }
  return res.json(toProjectBootstrapOperation(job));
});

export default router;
