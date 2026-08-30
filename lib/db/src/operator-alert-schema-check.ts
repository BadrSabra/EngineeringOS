import { pool } from "./index.js";
import type { QueryResultRow } from "pg";

type OperatorAlertSchemaQueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

const REQUIRED_COLUMNS = [
  "id",
  "fingerprint",
  "kind",
  "status",
  "provider",
  "model_role",
  "model_id",
  "title",
  "message",
  "remediation",
  "occurrence_count",
  "first_seen_at",
  "last_seen_at",
  "resolved_at",
] as const;

const REQUIRED_INDEX = "operator_alerts_fingerprint_unique";

export class OperatorAlertSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorAlertSchemaError";
  }
}

/**
 * Verify the durable operator-alert table before startup validation can
 * publish alerts. This is read-only; schema changes belong to schema:apply.
 */
export async function assertOperatorAlertSchemaWithClient(
  client: OperatorAlertSchemaQueryClient,
): Promise<void> {
  const tableResult = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'operator_alerts'
     ) AS "exists"`,
  );
  if (!tableResult.rows[0]?.exists) {
    throw new OperatorAlertSchemaError(
      "Missing required table public.operator_alerts. Apply the database schema with `pnpm --filter @workspace/db run schema:apply`, then restart the API.",
    );
  }

  const columnsResult = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'operator_alerts'`,
  );
  const actualColumns = new Set(columnsResult.rows.map(({ column_name }) => column_name));
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !actualColumns.has(column));
  const indexResult = await client.query<{ indexname: string }>(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'operator_alerts'
       AND indexname = $1`,
    [REQUIRED_INDEX],
  );

  if (missingColumns.length > 0 || indexResult.rowCount === 0) {
    const missing = [
      ...(missingColumns.length > 0 ? [`columns: ${missingColumns.join(", ")}`] : []),
      ...(indexResult.rowCount === 0 ? [`index: ${REQUIRED_INDEX}`] : []),
    ];
    throw new OperatorAlertSchemaError(
      `Stale public.operator_alerts schema (${missing.join("; ")}). Apply the database schema with \`pnpm --filter @workspace/db run schema:apply\`, then restart the API.`,
    );
  }
}

export async function assertOperatorAlertSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await assertOperatorAlertSchemaWithClient(client);
  } finally {
    client.release();
  }
}