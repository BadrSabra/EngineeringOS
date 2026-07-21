import app from "./app";
import { logger } from "./lib/logger";
import { getPort } from "./config";
import { reconcileStuckJobs, startStaleJobSweep } from "./lib/job-reconciliation";
import { fixDeadRootPaths } from "./lib/startup-migrations";
import { heavyJobQueue } from "./lib/job-queue";
import { pool } from "@workspace/db";
import {
  setInvalidationNotifier,
  startContextInvalidationChannel,
} from "@workspace/ai-orchestrator";

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
