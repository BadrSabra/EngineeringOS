import app from "./app";
import { logger } from "./lib/logger";
import { getPort } from "./config";
import { reconcileStuckJobs, startStaleJobSweep } from "./lib/job-reconciliation";
import { fixDeadRootPaths, ensureEncryptionKey } from "./lib/startup-migrations";
import { heavyJobQueue } from "./lib/job-queue";
import { pool } from "@workspace/db";
import {
  setInvalidationNotifier,
  startContextInvalidationChannel,
} from "@workspace/ai-orchestrator";

/**
 * DB-07: Bootstrap guard — verify the Drizzle schema has been pushed before
 * accepting traffic. Checks for a sentinel table (`projects`) that is created
 * by `cd lib/db && pnpm run push`. If absent, the server logs a clear,
 * actionable error and exits — preventing a misleading "running" state where
 * every API call would fail with cryptic 42P01 relation-not-found errors.
 */
async function assertDatabaseSchema(): Promise<void> {
  let result;
  try {
    result = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'projects'`,
    );
  } catch (err) {
    logger.error(
      { err },
      "DATABASE SCHEMA CHECK FAILED — cannot connect to the database or query information_schema",
    );
    process.exit(1);
  }

  if (result.rowCount === 0) {
    logger.error(
      {
        fix: "cd lib/db && pnpm run push",
        hint: "Run the above command to apply the Drizzle schema to the managed PostgreSQL database.",
      },
      [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "  DATABASE SCHEMA NOT FOUND — the 'projects' table is missing.",
        "  The Drizzle schema has not been pushed to this database yet.",
        "  Run:  cd lib/db && pnpm run push",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
    );
    process.exit(1);
  }
}

const port = getPort();

// ── PR-D3: Cross-process AI context cache invalidation ────────────────────────
// Wire a pg_notify call into every invalidateContextCache() invocation so
// sibling processes immediately evict their in-process copy instead of
// waiting up to 30 s for the TTL to expire.
setInvalidationNotifier((projectId: string) => {
  pool
    .query("SELECT pg_notify('ctx_invalid', $1)", [projectId])
    .catch((err: unknown) =>
      logger.warn(
        { err, projectId },
        "ctx-cache: pg_notify failed — degrading to TTL-only invalidation",
      ),
    );
});

// Start the dedicated LISTEN client that evicts local cache entries whenever
// another process fires pg_notify('ctx_invalid', projectId).
const { stop: stopCacheChannel } = startContextInvalidationChannel(pool);

// Graceful shutdown: release the LISTEN client so the PG connection is closed
// cleanly and the pool does not hang.
process.once("SIGTERM", () => {
  stopCacheChannel();
});
process.once("SIGINT", () => {
  stopCacheChannel();
});

// DB-07: Fail fast if the Drizzle schema has not been pushed yet. This must
// run before any other startup step that touches the database.
await assertDatabaseSchema();

// Ensure the AI credential encryption key is available before accepting traffic.
// Auto-generates and persists one if AI_CREDENTIALS_ENCRYPTION_KEY is not set.
await ensureEncryptionKey();

// Reconcile any scan/discovery jobs orphaned by a previous process (crash,
// deploy, kill) before accepting traffic — see job-reconciliation.ts. This
// never throws, so a reconciliation bug can't block startup.
await reconcileStuckJobs();

// Fix any projects whose root_path points to a deleted temp directory
// (e.g. a GitHub import clone under /tmp/eos-git-*). Never throws.
await fixDeadRootPaths();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  // PR-H (H-1): log queue stats on startup so operators can confirm the queue
  // is empty (running=0, queued=0) at a clean boot vs. after a crash-restart
  // where reconciliation may have re-enqueued pending jobs.
  // ⚠️  Durability caveat: this queue is process-local. Jobs in flight at the
  // time of a crash/restart are lost; reconciliation marks their DB rows as
  // `failed` so callers can detect and re-submit them.
  const queueStats = heavyJobQueue.getStats();
  logger.info({ port, jobQueue: queueStats }, "Server listening");

  // PR-02: start the periodic stale-job sweep now that the server is up.
  // Handles scan jobs that get stuck while the process is running (not just
  // crash-recovery, which is covered by reconcileStuckJobs above).
  startStaleJobSweep();
});
