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
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import { logger } from "./logger";

/** Canonical workspace root used in both dev and Replit production containers. */
const WORKSPACE_ROOT = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";

/** Path where an auto-generated encryption key is persisted across restarts. */
const ENCRYPTION_KEY_FILE = `${WORKSPACE_ROOT}/.local/encryption.key`;

/**
 * Ensures AI_CREDENTIALS_ENCRYPTION_KEY is set before the server accepts traffic.
 *
 * Resolution order:
 *   1. Already in process.env — nothing to do.
 *   2. Persisted in ENCRYPTION_KEY_FILE — load and set in process.env.
 *   3. Neither — generate a fresh 32-byte (64 hex char) key, persist it to
 *      ENCRYPTION_KEY_FILE, and set it in process.env for this process.
 *
 * The key file lives in .local/ (which should be in .gitignore) so it survives
 * Replit restarts without being committed to source control.
 *
 * Never throws — a failure here logs a warning; the credential routes already
 * return 500 with a clear message when the key is missing.
 */
export async function ensureEncryptionKey(): Promise<void> {
  const ENV_KEY = "AI_CREDENTIALS_ENCRYPTION_KEY";

  // 1. Already configured — nothing to do.
  if (process.env[ENV_KEY] && process.env[ENV_KEY]!.length === 64) return;

  try {
    // 2. Persisted key file exists — load it.
    const stored = (await fs.readFile(ENCRYPTION_KEY_FILE, "utf8")).trim();
    if (stored.length === 64 && /^[0-9a-f]+$/i.test(stored)) {
      process.env[ENV_KEY] = stored;
      logger.info({ scope: "startup-migrations", fn: "ensureEncryptionKey" },
        "Loaded AI credential encryption key from persistent key file");
      return;
    }
    logger.warn({ scope: "startup-migrations", fn: "ensureEncryptionKey", storedLength: stored.length },
      "Key file exists but is not a valid 64-char hex string — regenerating");
  } catch {
    // File does not exist yet — fall through to generate.
  }

  // 3. Generate a new key and persist it.
  try {
    const newKey = randomBytes(32).toString("hex");
    await fs.mkdir(`${WORKSPACE_ROOT}/.local`, { recursive: true });
    await fs.writeFile(ENCRYPTION_KEY_FILE, newKey, { mode: 0o600 });
    process.env[ENV_KEY] = newKey;
    logger.info({ scope: "startup-migrations", fn: "ensureEncryptionKey", keyFile: ENCRYPTION_KEY_FILE },
      "Generated and persisted new AI credential encryption key — credential storage is now active");
  } catch (err) {
    logger.error({ scope: "startup-migrations", fn: "ensureEncryptionKey", err },
      "Failed to generate/persist encryption key — credential storage will be unavailable until AI_CREDENTIALS_ENCRYPTION_KEY is set manually");
  }
}

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
