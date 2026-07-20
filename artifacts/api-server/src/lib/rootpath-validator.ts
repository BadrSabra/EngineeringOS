/**
 * Shared rootPath validator for AI route handlers.
 *
 * Centralises the "validate stored rootPath, fall back to workspace root"
 * logic that was previously duplicated across the chat and SSE-chat handlers
 * in routes/ai.ts (audit finding W-005, R-004).
 *
 * Improvements over the inline version:
 *   1. Single source of truth — one change fixes both call sites.
 *   2. Uses the structured pino logger (not console.warn) so fallback events
 *      are captured in log aggregation pipelines.
 *   3. Returns an explicit `fallbackUsed` flag so callers can surface the
 *      degraded state in their response or metrics.
 *   4. The WORKSPACE_FALLBACK path is constrained to paths that are readable
 *      by the process — it is never persisted to the DB.
 */
import fs from "fs/promises";
import { logger } from "./logger.js";

/** Resolved result from `resolveRootPath`. */
export interface RootPathResult {
  /**
   * The filesystem path that should be used for file-system tools.
   * `undefined` when neither the stored path nor the workspace fallback
   * is accessible — callers should degrade to knowledge-graph-only mode.
   */
  validRootPath: string | undefined;

  /** True when the workspace fallback was substituted for the stored path. */
  fallbackUsed: boolean;

  /** The original stored path (for logging / response metadata). */
  originalPath: string | null;
}

const WORKSPACE_FALLBACK = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";

/**
 * Resolve the effective rootPath for AI file-system tool access.
 *
 * 1. If `storedRootPath` is accessible → use it directly.
 * 2. If it is inaccessible (e.g. a deleted /tmp git clone) → fall back to
 *    `WORKSPACE_FALLBACK` for this request only. The fallback is **never**
 *    persisted to the DB so the original path remains recoverable (G-16).
 * 3. If neither is accessible → return `validRootPath: undefined` so the
 *    caller can degrade to knowledge-graph-only mode without file tools.
 */
export async function resolveRootPath(
  storedRootPath: string | null | undefined,
  projectId: string,
): Promise<RootPathResult> {
  const originalPath = storedRootPath ?? null;

  if (!originalPath) {
    return { validRootPath: undefined, fallbackUsed: false, originalPath };
  }

  // ── Primary path check ───────────────────────────────────────────────────
  try {
    await fs.access(originalPath);
    return { validRootPath: originalPath, fallbackUsed: false, originalPath };
  } catch {
    // Primary path inaccessible — try workspace fallback.
  }

  // ── Workspace fallback ───────────────────────────────────────────────────
  try {
    await fs.access(WORKSPACE_FALLBACK);

    // Log at warn level so the fallback is visible in structured log streams.
    // G-16: do NOT write WORKSPACE_FALLBACK to the DB — this is request-scoped.
    logger.warn(
      {
        scope: "rootpath-validator",
        code: "ROOTPATH_FALLBACK",
        projectId,
        original: originalPath,
        fallback: WORKSPACE_FALLBACK,
        note: "transient fallback only — rootPath not persisted to DB",
      },
      "project rootPath inaccessible; using workspace fallback for this request",
    );

    return {
      validRootPath: WORKSPACE_FALLBACK,
      fallbackUsed: true,
      originalPath,
    };
  } catch {
    // Workspace fallback also inaccessible — degrade to no file tools.
    logger.warn(
      {
        scope: "rootpath-validator",
        code: "ROOTPATH_NOT_ACCESSIBLE",
        projectId,
        rootPath: originalPath,
        fallback: WORKSPACE_FALLBACK,
      },
      "project rootPath and workspace fallback both inaccessible — file tools disabled",
    );

    return { validRootPath: undefined, fallbackUsed: false, originalPath };
  }
}
