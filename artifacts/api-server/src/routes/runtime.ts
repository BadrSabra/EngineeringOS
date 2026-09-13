import { Router } from "express";
import { requireProjectAccess, requireProjectWriteAccess } from "../middlewares/requireProjectAccess.js";
import {
  workspaceRuntime,
  WorkspaceRuntimeError,
} from "../lib/workspace-runtime.js";

const router = Router();

function runtimeErrorResponse(error: unknown) {
  if (error instanceof WorkspaceRuntimeError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code, retryable: error.status >= 500 },
    };
  }
  return {
    status: 500,
    body: {
      error: "Workspace runtime operation failed.",
      code: "RUNTIME_OPERATION_FAILED",
      retryable: true,
    },
  };
}

router.get("/projects/:projectId/runtime", requireProjectAccess, async (req, res) => {
  return res.json(await workspaceRuntime.get(req.project!.id));
});

router.post("/projects/:projectId/runtime/start", requireProjectWriteAccess, async (req, res) => {
  try {
    const snapshot = await workspaceRuntime.start({
      projectId: req.project!.id,
      projectRoot: req.project!.rootPath,
      revision: req.project!.updatedAt.toISOString(),
    });
    return res.json(snapshot);
  } catch (error) {
    const response = runtimeErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
});

router.post("/projects/:projectId/runtime/restart", requireProjectWriteAccess, async (req, res) => {
  try {
    const snapshot = await workspaceRuntime.start({
      projectId: req.project!.id,
      projectRoot: req.project!.rootPath,
      revision: req.project!.updatedAt.toISOString(),
      restart: true,
    });
    return res.json(snapshot);
  } catch (error) {
    const response = runtimeErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
});

router.post("/projects/:projectId/runtime/stop", requireProjectWriteAccess, async (req, res) => {
  try {
    return res.json(await workspaceRuntime.stop(req.project!.id));
  } catch (error) {
    const response = runtimeErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
});

export default router;