/**
 * Startup migrations — lightweight data corrections that run once per process
 * start, before the server begins accepting traffic.
 *
 * Rules:
 * - Every function MUST be async and MUST NOT throw (catch internally and log).
 * - Keep each migration idempotent — safe to run on every restart.
 * - No DDL here; schema changes go through Replit's publish-time migration flow.
 */

import fs from "node:fs/promises";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import { logger } from "./logger";

/** Canonical workspace root used in both dev and Replit production containers. */
const WORKSPACE_ROOT = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";

/**
 * Projects imported via a temporary git clone (e.g. GitHub discovery) get a
 * root_path like `/tmp/eos-git-<uuid>`. That directory is deleted as soon as
 * discovery completes, leaving the project permanently inaccessible to the
 * file-system tools and the scanner.
 *
 * On startup, if WORKSPACE_ROOT exists on disk, update every such project to
 * point at the real workspace instead of the deleted temp path.
 */
export async function fixDeadRootPaths(): Promise<void> {
  try {
    // Verify the workspace root is accessible before updating anything.
    await fs.access(WORKSPACE_ROOT);
  } catch {
    logger.warn({ scope: "startup-migrations", fn: "fixDeadRootPaths", WORKSPACE_ROOT },
      "Workspace root not accessible — skipping dead-root-path fix");
    return;
  }

  try {
    const updated = await db
      .update(projectsTable)
      .set({ rootPath: WORKSPACE_ROOT })
      .where(
        // Match any path that looks like a temp git-clone directory and is NOT
        // already pointing at the workspace root.
        like(projectsTable.rootPath, "/tmp/eos-git-%"),
      )
      .returning({ id: projectsTable.id, name: projectsTable.name, oldPath: projectsTable.rootPath });

    if (updated.length > 0) {
      logger.info(
        { scope: "startup-migrations", fn: "fixDeadRootPaths", count: updated.length, newPath: WORKSPACE_ROOT, projects: updated.map((p) => p.id) },
        `Fixed ${updated.length} project(s) with dead temp root_path → ${WORKSPACE_ROOT}`,
      );
    }
  } catch (err) {
    logger.error({ scope: "startup-migrations", fn: "fixDeadRootPaths", err },
      "Failed to fix dead root_paths — continuing startup");
  }
}
