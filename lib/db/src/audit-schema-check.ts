import { pool } from "./index.js";
import type { PoolClient, QueryResultRow } from "pg";

type AuditSchemaQueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

const REQUIRED_COLUMNS = [
  "id",
  "row",
  "attempts",
  "next_attempt_at",
  "created_at",
] as const;
const REQUIRED_INDEX = "idx_pending_audit_logs_next_attempt_at";

export class AuditSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditSchemaError";
  }
}

/**
 * Verify the durable audit outbox schema before it is used.
 *
 * This is intentionally read-only. Schema changes belong to the Drizzle push
 * step, not to API startup.
 */
export async function assertAuditOutboxSchemaWithClient(
  client: AuditSchemaQueryClient,
): Promise<void> {
  const tableResult = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'pending_audit_logs'
       ) AS "exists"`,
    );

    if (!tableResult.rows[0]?.exists) {
      throw new AuditSchemaError(
        "Missing required table public.pending_audit_logs. Apply the database schema with `pnpm --filter @workspace/db run push`, then restart the API.",
      );
    }

    const columnsResult = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pending_audit_logs'`,
    );
    const actualColumns = new Set(
      columnsResult.rows.map(({ column_name }) => column_name),
    );
    const missingColumns = REQUIRED_COLUMNS.filter(
      (column) => !actualColumns.has(column),
    );

    const indexResult = await client.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'pending_audit_logs'
         AND indexname = $1`,
      [REQUIRED_INDEX],
    );

    if (missingColumns.length > 0 || indexResult.rowCount === 0) {
      const missing = [
        ...(missingColumns.length > 0
          ? [`columns: ${missingColumns.join(", ")}`]
          : []),
        ...(indexResult.rowCount === 0 ? [`index: ${REQUIRED_INDEX}`] : []),
      ];
      throw new AuditSchemaError(
        `Stale public.pending_audit_logs schema (${missing.join("; ")}). Apply the database schema with \`pnpm --filter @workspace/db run push\`, then restart the API.`,
      );
    }
}

export async function assertAuditOutboxSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await assertAuditOutboxSchemaWithClient(client);
  } finally {
    client.release();
  }
}
