/**
 * PostgreSQL session-level advisory locks for distributed mutual exclusion.
 *
 * Replaces the process-local Set<string> guards used for workflow orchestration
 * and project apply-changes serialisation. Advisory locks are held at the
 * Postgres session level rather than a transaction level, which means a single
 * pool connection is dedicated for the duration of the lock so the lock and
 * unlock statements execute on the same session — required for session-scoped
 * advisory locks.
 *
 * Usage:
 *
 *   const lock = await tryAdvisoryLock(LockNamespace.ORCHESTRATION, workflowId);
 *   if (!lock.acquired) {
 *     return res.status(409).json({ error: "already in progress" });
 *   }
 *   try {
 *     // ... do the protected work ...
 *   } finally {
 *     await lock.release();
 *   }
 */

import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

// Stable namespace integers — never reuse a value for a different domain.
// pg_try_advisory_lock(int4, int4) accepts two 32-bit signed integers.
export const LockNamespace = {
  /** Guards POST /ai/workflows/:id/orchestrate */
  ORCHESTRATION: 1001,
  /** Guards POST /ai/chat/apply-changes */
  APPLY: 1002,
} as const;

/**
 * Deterministic djb2 hash of a string into a signed 32-bit integer.
 * Used as the second key argument to pg_try_advisory_lock(namespace, key).
 */
function hashId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0; // force signed 32-bit
  }
  return h;
}

export type LockAcquired = {
  acquired: true;
  /** Releases the advisory lock and returns the connection to the pool. */
  release(): Promise<void>;
};

export type LockBusy = { acquired: false };
export type AdvisoryLockResult = LockAcquired | LockBusy;

/**
 * Try to acquire a PostgreSQL session-level advisory lock without waiting.
 *
 * Returns `{ acquired: false }` immediately if the lock is held by another
 * session (e.g. another API server instance), so callers can return 409
 * without blocking.
 *
 * Always call `lock.release()` in a `finally` block when `lock.acquired` is
 * true — not releasing leaks the connection back to the pool in a locked state.
 */
export async function tryAdvisoryLock(
  namespace: number,
  id: string,
): Promise<AdvisoryLockResult> {
  const key2 = hashId(id);
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    // If we can't get a connection, fall through to let the caller decide —
    // returning "not acquired" is the safest default (callers will 409 rather
    // than risk two concurrent executions).
    throw err;
  }

  let acquired = false;
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [namespace, key2],
    );
    acquired = rows[0]?.acquired ?? false;
  } catch (err) {
    client.release();
    throw err;
  }

  if (!acquired) {
    client.release();
    return { acquired: false };
  }

  return {
    acquired: true,
    async release() {
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [namespace, key2]);
      } finally {
        client.release();
      }
    },
  };
}
