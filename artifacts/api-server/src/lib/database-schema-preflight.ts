import {
  assertApplicationSchemaWithClient,
  findApplicationSchemaIssues,
  readApplicationSchemaSnapshot,
} from "@workspace/db";
import type {
  ApplicationSchemaIssue,
  ApplicationSchemaSnapshot,
} from "@workspace/db";

export type ApplicationSchemaQuery = Parameters<
  typeof readApplicationSchemaSnapshot
>[0];

export {
  type ApplicationSchemaIssue,
  type ApplicationSchemaSnapshot,
  findApplicationSchemaIssues,
};

/**
 * Kept as a named API-server boundary so startup and focused API tests use
 * the same read-only contract as the database package.
 */
export async function assertDatabaseApplicationSchema(
  queryable: ApplicationSchemaQuery,
): Promise<void> {
  await assertApplicationSchemaWithClient(queryable);
}

export async function getApplicationSchemaSnapshot(
  queryable: ApplicationSchemaQuery,
): Promise<ApplicationSchemaSnapshot> {
  return readApplicationSchemaSnapshot(queryable);
}

/**
 * Legacy narrow helper retained for callers that have not moved to the
 * complete application contract yet. Startup intentionally does not use it.
 */
export const REQUIRED_DATABASE_COLUMNS = [
  { tableName: "projects", columnName: "id" },
  { tableName: "ai_executions", columnName: "operation_id" },
  { tableName: "tasks", columnName: "remediation_plan" },
] as const;

export function findMissingDatabaseColumns(
  rows: ReadonlyArray<{ table_name?: string; column_name?: string }>,
): string[] {
  const found = new Set(
    rows.map((row) => `${row.table_name}.${row.column_name}`),
  );
  return REQUIRED_DATABASE_COLUMNS.map(
    ({ tableName, columnName }) => `${tableName}.${columnName}`,
  ).filter((required) => !found.has(required));
}

type LegacyDatabaseSchemaQuery = {
  query: (sql: string) => Promise<{
    rows: Array<{ table_name?: string; column_name?: string }>;
  }>;
};

export async function getMissingDatabaseColumns(
  queryable: LegacyDatabaseSchemaQuery,
): Promise<string[]> {
  const result = await queryable.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'projects' AND column_name = 'id')
        OR (table_name = 'ai_executions' AND column_name = 'operation_id')
        OR (table_name = 'tasks' AND column_name = 'remediation_plan')
      )
  `);
  return findMissingDatabaseColumns(result.rows);
}