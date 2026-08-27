export const REQUIRED_DATABASE_COLUMNS = [
  { tableName: "projects", columnName: "id" },
  { tableName: "ai_executions", columnName: "operation_id" },
  { tableName: "tasks", columnName: "remediation_plan" },
] as const;

export interface DatabaseSchemaQuery {
  query: (sql: string) => Promise<{
    rows: Array<{ table_name?: string; column_name?: string }>;
  }>;
}

export function findMissingDatabaseColumns(
  rows: ReadonlyArray<{ table_name?: string; column_name?: string }>,
): string[] {
  const found = new Set(
    rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  return REQUIRED_DATABASE_COLUMNS
    .map(({ tableName, columnName }) => `${tableName}.${columnName}`)
    .filter((required) => !found.has(required));
}

export async function getMissingDatabaseColumns(
  queryable: DatabaseSchemaQuery,
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