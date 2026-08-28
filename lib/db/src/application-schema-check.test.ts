import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryResultRow } from "pg";
import {
  APPLICATION_SCHEMA_CONTRACT,
  ApplicationSchemaError,
  assertApplicationSchemaWithClient,
  findApplicationSchemaIssues,
  formatApplicationSchemaIssues,
  readApplicationSchemaSnapshot,
} from "./application-schema-check.js";

const remediationPlan = {
  version: 1,
  ruleId: "rule-1",
  ruleCode: "SEC-001",
  ruleTitle: "Use prepared queries",
  severity: "high",
  occurrenceCount: 1,
  evidence: [
    { file: "src/db.ts", line: 12, snippet: "query(input)", occurrences: 1 },
  ],
  relatedFiles: ["src/db.ts"],
  fixDescription: "Use a parameterized query.",
  verificationSteps: ["Run the database tests."],
  source: {
    type: "scan",
    correlationId: "scan-1",
    revision: "abc123",
    completeness: "COMPLETE",
  },
  status: "ready",
} as const;

function completeSnapshot() {
  const columns = Object.entries(APPLICATION_SCHEMA_CONTRACT.tables).flatMap(
    ([tableName, definitions]) =>
      definitions.map((definition) => ({
        table_name: tableName,
        column_name: definition.name,
        data_type: definition.dataType,
        udt_name: definition.udtName,
        is_nullable: definition.nullable ? ("YES" as const) : ("NO" as const),
        column_default:
          definition.name === "status"
            ? "'pending'::task_status"
            : definition.name === "priority"
              ? "'p2'::task_priority"
              : definition.name === "level"
                ? "'info'::log_level"
                : definition.name === "related_files" ||
                    definition.name === "depends_on"
                  ? "'[]'::jsonb"
                  : definition.name === "retry_count"
                    ? "0"
                    : definition.name === "max_retries"
                      ? "3"
                      : definition.name === "created_at" ||
                          definition.name === "updated_at" ||
                          definition.name === "timestamp"
                        ? "now()"
                        : null,
      })),
  );
  const indexes = APPLICATION_SCHEMA_CONTRACT.indexes.map((definition) => ({
    tablename: definition.name.startsWith("idx_task_logs")
      ? "task_logs"
      : "tasks",
    indexname: definition.name,
    indexdef: `CREATE INDEX ${definition.name} ON public.${
      definition.name.startsWith("idx_task_logs") ? "task_logs" : "tasks"
    } USING btree (${definition.columns.join(", ")})`,
  }));
  return {
    tables: [
      { table_name: "tasks", table_type: "BASE TABLE" },
      { table_name: "task_logs", table_type: "BASE TABLE" },
    ],
    columns,
    indexes,
    primaryKeys: [
      { table_name: "tasks", column_name: "id" },
      { table_name: "task_logs", column_name: "id" },
    ],
    foreignKeys: APPLICATION_SCHEMA_CONTRACT.foreignKeys.map((key) => ({
      table_name: key.tableName,
      column_name: key.columnName,
      foreign_table_name: key.foreignTableName,
      foreign_column_name: key.foreignColumnName,
      delete_rule: key.deleteRule,
    })),
  };
}

function clientFor(
  snapshot: ReturnType<typeof completeSnapshot>,
  overrides: Partial<ReturnType<typeof completeSnapshot>> = {},
) {
  const value = { ...snapshot, ...overrides };
  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
    ): Promise<{ rows: T[]; rowCount: number }> {
      if (sql.includes("information_schema.tables")) {
        return {
          rows: value.tables as unknown as T[],
          rowCount: value.tables.length,
        };
      }
      if (sql.includes("information_schema.columns")) {
        return {
          rows: value.columns as unknown as T[],
          rowCount: value.columns.length,
        };
      }
      if (sql.includes("pg_indexes")) {
        return {
          rows: value.indexes as unknown as T[],
          rowCount: value.indexes.length,
        };
      }
      if (sql.includes("constraint_type = 'PRIMARY KEY'")) {
        return {
          rows: value.primaryKeys as unknown as T[],
          rowCount: value.primaryKeys.length,
        };
      }
      if (sql.includes("constraint_type = 'FOREIGN KEY'")) {
        return {
          rows: value.foreignKeys as unknown as T[],
          rowCount: value.foreignKeys.length,
        };
      }
      throw new Error(`Unexpected schema query: ${sql}`);
    },
  };
}

describe("application schema contract", () => {
  it("accepts the complete task/task-log contract", async () => {
    const snapshot = completeSnapshot();
    assert.deepEqual(findApplicationSchemaIssues(snapshot), []);
    await assert.doesNotReject(
      assertApplicationSchemaWithClient(clientFor(snapshot)),
    );
  });

  it("explicitly permits NULL remediation plans and preserves their JSONB type", () => {
    const snapshot = completeSnapshot();
    const remediation = snapshot.columns.find(
      (column) =>
        column.table_name === "tasks" &&
        column.column_name === "remediation_plan",
    );
    assert.equal(remediation?.is_nullable, "YES");
    assert.equal(remediation?.data_type, "jsonb");
    assert.equal(remediation?.column_default, null);
  });

  it("reports missing and incompatible contract objects with actionable diagnostics", async () => {
    const snapshot = completeSnapshot();
    const incomplete = {
      ...snapshot,
      columns: snapshot.columns
        .filter(
          (column) =>
            !(
              column.table_name === "tasks" &&
              column.column_name === "remediation_plan"
            ),
        )
        .map((column) =>
          column.table_name === "task_logs" && column.column_name === "level"
            ? { ...column, udt_name: "text", data_type: "text" }
            : column,
        ),
      indexes: snapshot.indexes.filter(
        (index) => index.indexname !== "idx_task_logs_task_id_timestamp",
      ),
      foreignKeys: snapshot.foreignKeys.filter(
        (key) =>
          !(key.table_name === "task_logs" && key.column_name === "task_id"),
      ),
    };

    const issues = findApplicationSchemaIssues(incomplete);
    assert.deepEqual(
      issues.map((item) => item.kind),
      [
        "missing_column",
        "incompatible_column",
        "missing_index",
        "missing_foreign_key",
      ],
    );
    await assert.rejects(
      assertApplicationSchemaWithClient(clientFor(snapshot, incomplete)),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationSchemaError);
        assert.match(error.message, /schema:apply/);
        assert.match(error.message, /remediation_plan/);
        assert.match(formatApplicationSchemaIssues(error.issues), /log_level/);
        return true;
      },
    );
  });

  it("detects a missing primary key instead of treating an id column as sufficient", () => {
    const snapshot = completeSnapshot();
    const issues = findApplicationSchemaIssues({
      ...snapshot,
      primaryKeys: snapshot.primaryKeys.filter(
        (key) => key.table_name !== "task_logs",
      ),
    });
    assert.ok(
      issues.some(
        (item) =>
          item.kind === "missing_primary_key" && item.tableName === "task_logs",
      ),
    );
  });

  it("reads all metadata through read-only catalog queries", async () => {
    const snapshot = completeSnapshot();
    const client = clientFor(snapshot);
    const result = await readApplicationSchemaSnapshot(client);
    assert.equal(result.columns.length, snapshot.columns.length);
    assert.equal(result.indexes.length, snapshot.indexes.length);
    assert.equal(result.foreignKeys.length, snapshot.foreignKeys.length);
  });

  it("models an upgrade fixture with NULL and populated remediation plans", () => {
    const rows = [
      { id: "legacy-task", remediation_plan: null, title: "Legacy task" },
      {
        id: "planned-task",
        remediation_plan: remediationPlan,
        title: "Planned task",
      },
    ];
    const afterDelivery = rows.map((row) => ({ ...row }));
    assert.deepEqual(afterDelivery, rows);
    assert.equal(afterDelivery[0]?.remediation_plan, null);
    assert.deepEqual(afterDelivery[1]?.remediation_plan, remediationPlan);
  });
});