/**
 * Shared rootPath validator for AI route handlers.
 *
 * Centralises the "validate stored rootPath, fall back to workspace root"
 * logic that was previously duplicated across the chat and SSE-chat handlers
 * in routes/ai.ts (audit finding W-005, R-004).
 *
 * Improvements over the inline version:
 *   1. Single source of truth — one change fixes both call sites.
 *   2. Uses the structured pino logger (not console.warn) so boundary failures
 *      are captured in log aggregation pipelines.
 *   3. Returns an explicit `fallbackUsed` flag so callers can surface the
 *      degraded state in their response or metrics.
 *   4. An unavailable project root never falls back to the shared workspace.
 *      Callers must disable filesystem operations for that request.
 */
import fs from "fs/promises";
import { logger } from "./logger.js";

/** Resolved result from `resolveRootPath`. */
export interface RootPathResult {
  /**
   * The filesystem path that should be used for file-system tools.
   * `undefined` when the stored project path is inaccessible — callers must
   * disable filesystem access for the operation.
   */
  validRootPath: string | undefined;

  /** Retained for response compatibility; always false under fail-closed policy. */
  fallbackUsed: boolean;

  /** The original stored path (for logging / response metadata). */
  originalPath: string | null;
}

/**
 * Resolve the effective rootPath for AI file-system tool access.
 *
 * 1. If `storedRootPath` is accessible → use it directly.
 * 2. If it is inaccessible (e.g. a deleted /tmp git clone), return
 *    `validRootPath: undefined`. Never substitute the shared workspace:
 *    doing so would expose files from another tenant.
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
    // Primary path inaccessible — do not substitute another tenant's root.
  }

  logger.warn(
    {
      scope: "rootpath-validator",
      code: "ROOTPATH_NOT_ACCESSIBLE",
      projectId,
      rootPath: originalPath,
    },
    "project rootPath is inaccessible — file tools disabled",
  );
  return { validRootPath: undefined, fallbackUsed: false, originalPath };
}
