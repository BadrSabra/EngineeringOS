import app from "./app";
import { logger } from "./lib/logger";
import { getPort } from "./config";
import {
  reconcileStuckJobs,
  startDurableJobDispatcher,
  startStaleJobSweep,
} from "./lib/job-reconciliation";
import {
  reportDeadRootPaths,
  ensureEncryptionKey,
  scrubHistoricalValidationDetails,
} from "./lib/startup-migrations";
import { heavyJobQueue } from "./lib/job-queue";
import { assertAuditOutboxSchema, pool } from "@workspace/db";
import {
  setInvalidationNotifier,
  startContextInvalidationChannel,
  validateAiProvidersAtStartup,
  startMemorySweep,
} from "@workspace/ai-orchestrator";
import { startCatalogRefreshScheduler } from "./lib/catalog-refresh-scheduler";
import { drainPendingAudits, loadPendingAudits } from "./lib/audit";

/**
 * DB-07: Bootstrap guard — verify the Drizzle schema has been pushed before
 * accepting traffic. Checks the sentinel project table and the durable
 * execution column used by the current server build. If either is absent,
 * the server logs a clear, actionable error and exits.
 */
async function assertDatabaseSchema(): Promise<void> {
  let result;
  try {
    result = await pool.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'projects' AND column_name = 'id')
           OR (table_name = 'ai_executions' AND column_name = 'operation_id')
         )`,
    );
  } catch (err) {
    logger.error(
      { err },
      "DATABASE SCHEMA CHECK FAILED — cannot connect to the database or query information_schema",
    );
    process.exit(1);
  }

  const found = new Set(
    result.rows.map((row: { table_name?: string; column_name?: string }) =>
      `${row.table_name}.${row.column_name}`),
  );
  const missing = [
    "projects.id",
    "ai_executions.operation_id",
  ].filter((required) => !found.has(required));

  if (missing.length > 0) {
    logger.error(
      {
        fix: "cd lib/db && pnpm run push",
        hint: "Run the above command to apply the Drizzle schema to the managed PostgreSQL database.",
        missing,
      },
      [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        `  DATABASE SCHEMA INCOMPLETE — missing: ${missing.join(", ")}.`,
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
  stopCatalogRefresh();
});
process.once("SIGINT", () => {
  stopCacheChannel();
  stopCatalogRefresh();
});

// DB-07: Fail fast if the Drizzle schema has not been pushed yet. This must
// run before any other startup step that touches the database.
await assertDatabaseSchema();
try {
  await assertAuditOutboxSchema();
} catch (err) {
  logger.error(
    { err, fix: "pnpm --filter @workspace/db run push" },
    "AUDIT OUTBOX SCHEMA CHECK FAILED — apply the Drizzle schema before starting the API",
  );
  process.exit(1);
}

// Start the background free-model catalog refresh scheduler.  Runs every 5
// minutes so the resolver always has a fresh live list of free-tier models —
// even when the server is idle between user sessions.  The first refresh
// fires immediately (before traffic arrives) so the catalog is pre-warmed.
const { stop: stopCatalogRefresh } = startCatalogRefreshScheduler();

// PR-006: validate AI providers before accepting traffic — checks key presence
// and refreshes the dynamic OpenRouter model catalog so the resolver knows which
// models are currently available. Never throws; logs actionable warnings.
validateAiProvidersAtStartup().catch((err: unknown) => {
  logger.warn({ err }, "AI provider startup validation failed — continuing without AI validation");
});

// Ensure the AI credential encryption key is available before accepting traffic.
// Auto-generates and persists one if AI_CREDENTIALS_ENCRYPTION_KEY is not set.
await ensureEncryptionKey();

// Reconcile any scan/discovery jobs orphaned by a previous process (crash,
// deploy, kill) before accepting traffic — see job-reconciliation.ts. This
// never throws, so a reconciliation bug can't block startup.
await reconcileStuckJobs();

// Report (read-only) any projects whose root_path points to a dead temp
// directory (e.g. a legacy GitHub import clone under /tmp/eos-git-*). Roots
// are never rewritten — scans of such projects fail with root_unavailable
// until the project is re-imported via discovery. Never throws.
await reportDeadRootPaths();

// Remove raw validation commands, output, failed-test details, and changed
// files from records written by older server builds. The migration is
// idempotent and preserves proof/exit metadata.
await scrubHistoricalValidationDetails();

// Reload audit writes that failed in a previous process before accepting
// traffic, then let the normal retry worker drain them in the background.
await loadPendingAudits();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  // PR-H (H-1): log queue stats on startup so operators can confirm the queue
  // is empty (running=0, queued=0) at a clean boot vs. after a crash-restart
  // where reconciliation may have re-enqueued pending jobs or paused durable
  // AI executions for explicit resume.
  // ⚠️  Durability caveat: this queue is process-local. Jobs in flight at the
  // time of a crash/restart are lost; reconciliation marks their DB rows as
  // `failed` so callers can detect and re-submit them.
  const queueStats = heavyJobQueue.getStats();
  logger.info({ port, jobQueue: queueStats }, "Server listening");

  // PR-02: start the periodic stale-job sweep now that the server is up.
  // Handles scan jobs that get stuck while the process is running (not just
  // crash-recovery, which is covered by reconcileStuckJobs above).
  startStaleJobSweep();

  // Durable dispatch is separate from the slow stale-job sweep. It scans the
  // persisted queue rows frequently so another instance can recover work that
  // was committed just before the original process disappeared.
  startDurableJobDispatcher();

  // Start the session-memory sweep — prunes expired/decayed memory rows and
  // applies daily relevance decay.  Runs every 6 hours; fires once immediately
  // at startup to clear any backlog from a restart.
  startMemorySweep();

  // Audit rows that failed after a successful business mutation are retried
  // in the background; the worker keeps them visible through /healthz.
  void drainPendingAudits();
});
