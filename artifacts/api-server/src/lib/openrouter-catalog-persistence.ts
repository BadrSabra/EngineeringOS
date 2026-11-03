import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import type {
  OpenRouterCatalogPersistence,
  OpenRouterCatalogSnapshot,
  OpenRouterCatalogStoredState,
} from "@workspace/ai-orchestrator";

const CATALOG_KEY = "openrouter-free-models-v1";
const LEASE_POLL_INTERVAL_MS = 40;

type CatalogRow = {
  snapshot: unknown;
  refreshed_at: Date | string | null;
  expires_at: Date | string | null;
  failure_backoff_until: Date | string | null;
  last_failure_code: string | null;
};

function timestampMs(value: Date | string | null): number | null {
  if (value === null) return null;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

/**
 * PostgreSQL-backed catalog snapshot and refresh lease shared by API workers.
 * It stores normalized model metadata and bounded failure codes, never raw
 * provider payloads or credentials. Only the validated zero-price list proves
 * free-catalog eligibility; other candidate metadata remains policy-gated.
 */
type CatalogPersistencePool = Pick<typeof pool, "query">;

export function createOpenRouterCatalogPersistence(
  databasePool: CatalogPersistencePool,
): OpenRouterCatalogPersistence {
  const persistence: OpenRouterCatalogPersistence = {
    async read(): Promise<OpenRouterCatalogStoredState | null> {
      const result = await databasePool.query<CatalogRow>(
      `SELECT snapshot, refreshed_at, expires_at,
              failure_backoff_until, last_failure_code
       FROM openrouter_catalog_snapshots
       WHERE catalog_key = $1
       LIMIT 1`,
        [CATALOG_KEY],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        snapshot: row.snapshot as OpenRouterCatalogSnapshot | null,
        refreshedAtMs: timestampMs(row.refreshed_at),
        expiresAtMs: timestampMs(row.expires_at),
        failureBackoffUntilMs: timestampMs(row.failure_backoff_until),
        lastFailureCode: row.last_failure_code,
      };
    },

    async acquireRefreshLease(
      maxWaitMs: number,
      leaseDurationMs: number,
    ) {
      const startedAt = Date.now();
      const token = randomUUID();
      const boundedWaitMs = Math.max(0, Math.ceil(maxWaitMs));
      const boundedLeaseMs = Math.max(1_000, Math.ceil(leaseDurationMs));

      while (Date.now() - startedAt <= boundedWaitMs) {
        const result = await databasePool.query<{ lease_token: string }>(
        `INSERT INTO openrouter_catalog_snapshots
           (catalog_key, lease_token, lease_expires_at, updated_at)
         VALUES (
           $1,
           $2,
           clock_timestamp() + ($3::double precision * interval '1 millisecond'),
           clock_timestamp()
         )
         ON CONFLICT (catalog_key) DO UPDATE
         SET lease_token = EXCLUDED.lease_token,
             lease_expires_at = EXCLUDED.lease_expires_at,
             updated_at = clock_timestamp()
         WHERE openrouter_catalog_snapshots.lease_expires_at IS NULL
            OR openrouter_catalog_snapshots.lease_expires_at <= clock_timestamp()
         RETURNING lease_token`,
          [CATALOG_KEY, token, boundedLeaseMs],
        );
        if (result.rows[0]?.lease_token === token) {
          let released = false;
          const assertLeaseStillOwned = async (sql: string, values: unknown[]) => {
            if (released) throw new Error("OpenRouter catalog refresh lease already released");
            const write = await databasePool.query(sql, values);
            if (write.rowCount !== 1) {
              throw new Error("OpenRouter catalog refresh lease expired before its write");
            }
          };

          return {
            async commitSnapshot(
              snapshot: OpenRouterCatalogSnapshot,
              ttlMs: number,
            ): Promise<OpenRouterCatalogStoredState> {
              await assertLeaseStillOwned(
              `UPDATE openrouter_catalog_snapshots
               SET snapshot = $3::jsonb,
                   refreshed_at = clock_timestamp(),
                   expires_at = clock_timestamp() + ($4::double precision * interval '1 millisecond'),
                   failure_backoff_until = NULL,
                   last_failure_code = NULL,
                   updated_at = clock_timestamp()
               WHERE catalog_key = $1
                 AND lease_token = $2
                 AND lease_expires_at > clock_timestamp()`,
                [CATALOG_KEY, token, JSON.stringify(snapshot), Math.max(1_000, Math.ceil(ttlMs))],
              );
              const state = await persistence.read();
              if (!state) throw new Error("OpenRouter catalog snapshot disappeared after commit");
              return state;
            },
            async recordFailure(failureCode: string, backoffMs: number) {
              await assertLeaseStillOwned(
              `UPDATE openrouter_catalog_snapshots
               SET failure_backoff_until = clock_timestamp() + ($3::double precision * interval '1 millisecond'),
                   last_failure_code = $4,
                   updated_at = clock_timestamp()
               WHERE catalog_key = $1
                 AND lease_token = $2
                 AND lease_expires_at > clock_timestamp()`,
                [CATALOG_KEY, token, Math.max(1_000, Math.ceil(backoffMs)), failureCode.slice(0, 80)],
              );
            },
            async release() {
              if (released) return;
              released = true;
              await databasePool.query(
              `UPDATE openrouter_catalog_snapshots
               SET lease_token = NULL,
                   lease_expires_at = NULL,
                   updated_at = clock_timestamp()
               WHERE catalog_key = $1 AND lease_token = $2`,
                [CATALOG_KEY, token],
              );
            },
          };
        }

        const remainingMs = boundedWaitMs - (Date.now() - startedAt);
        if (remainingMs <= 0) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(LEASE_POLL_INTERVAL_MS, remainingMs)),
        );
      }
      return undefined;
    },
  };
  return persistence;
}

export const openRouterCatalogPersistence =
  createOpenRouterCatalogPersistence(pool);
