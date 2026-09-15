import { Router } from "express";
import { requireProjectAccess, requireProjectWriteAccess } from "../middlewares/requireProjectAccess.js";
import {
  workspaceRuntime,
  WorkspaceRuntimeError,
} from "../lib/workspace-runtime.js";
import {
  recordRuntimeObservation,
  RuntimeObservationError,
} from "../lib/runtime-observations.js";

const router = Router();

function runtimeErrorResponse(error: unknown) {
  if (error instanceof WorkspaceRuntimeError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code, retryable: error.status >= 500 },
    };
  }
  if (error instanceof RuntimeObservationError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code, retryable: false },
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

router.post("/projects/:projectId/runtime/observations", requireProjectWriteAccess, async (req, res) => {
  const body = req.body as {
    sourcePath?: unknown;
    sourceName?: unknown;
    targetPath?: unknown;
    targetName?: unknown;
    relationType?: unknown;
    line?: unknown;
    column?: unknown;
    snippet?: unknown;
  };
  if (
    typeof body.sourcePath !== "string"
    || typeof body.sourceName !== "string"
    || typeof body.targetPath !== "string"
    || typeof body.targetName !== "string"
    || (body.relationType !== undefined && body.relationType !== "calls" && body.relationType !== "uses")
  ) {
    return res.status(400).json({
      error: "Runtime observations require source/target names and project-relative paths.",
      code: "RUNTIME_OBSERVATION_INVALID",
      retryable: false,
    });
  }
  const snapshot = await workspaceRuntime.get(req.project!.id);
  if (!snapshot.sessionId || !snapshot.revision) {
    return res.status(409).json({
      error: "The workspace runtime is not ready to accept observations.",
      code: "RUNTIME_SESSION_UNAVAILABLE",
      retryable: false,
    });
  }
  try {
    const observation = await recordRuntimeObservation({
      projectId: req.project!.id,
      sessionId: snapshot.sessionId,
      runtimeRevision: snapshot.revision,
      sourcePath: body.sourcePath,
      sourceName: body.sourceName,
      targetPath: body.targetPath,
      targetName: body.targetName,
      relationType: body.relationType as "calls" | "uses" | undefined,
      line: typeof body.line === "number" ? body.line : undefined,
      column: typeof body.column === "number" ? body.column : undefined,
      snippet: typeof body.snippet === "string" ? body.snippet : undefined,
    });
    return res.status(201).json(observation);
  } catch (error) {
    const response = runtimeErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
});

export default router;