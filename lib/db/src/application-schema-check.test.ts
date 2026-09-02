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
  const defaultFor = (tableName: string, columnName: string) => {
    if (columnName === "status") return "'pending'::task_status";
    if (columnName === "priority") return "'p2'::task_priority";
    if (columnName === "level") return "'info'::log_level";
    if (
      (tableName === "tasks" &&
        (columnName === "related_files" || columnName === "depends_on")) ||
      (tableName === "ai_session_memory_outbox" &&
        (columnName === "tool_sources" || columnName === "semantic_records"))
    ) {
      return "'[]'::jsonb";
    }
    if (columnName === "retry_count" || columnName === "attempts") return "0";
    if (columnName === "max_retries") return "3";
    if (columnName === "relevance") return "1.0";
    if (
      columnName === "created_at" ||
      columnName === "updated_at" ||
      columnName === "timestamp"
    ) {
      return "now()";
    }
    return null;
  };
  const columns = Object.entries(APPLICATION_SCHEMA_CONTRACT.tables).flatMap(
    ([tableName, definitions]) =>
      definitions.map((definition) => ({
        table_name: tableName,
        column_name: definition.name,
        data_type: definition.dataType,
        udt_name: definition.udtName,
        is_nullable: definition.nullable ? ("YES" as const) : ("NO" as const),
        column_default: defaultFor(tableName, definition.name),
      })),
  );
  const indexes = APPLICATION_SCHEMA_CONTRACT.indexes.map((definition) => ({
    tablename: definition.tableName,
    indexname: definition.name,
    indexdef: `CREATE INDEX ${definition.name} ON public.${definition.tableName} USING btree (${definition.columns.join(", ")})`,
  }));
  return {
    tables: Object.keys(APPLICATION_SCHEMA_CONTRACT.tables).map((table_name) => ({
      table_name,
      table_type: "BASE TABLE",
    })),
    columns,
    enums: Object.entries(APPLICATION_SCHEMA_CONTRACT.enums).map(
      ([enum_name, enum_labels]) => ({
        enum_name,
        enum_labels: [...enum_labels],
      }),
    ),
    indexes,
    primaryKeys: Object.keys(APPLICATION_SCHEMA_CONTRACT.tables).map(
      (table_name) => ({ table_name, column_name: "id" }),
    ),
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
      if (sql.includes("FROM pg_type")) {
        return {
          rows: value.enums as unknown as T[],
          rowCount: value.enums.length,
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
  it("accepts the complete application contract", async () => {
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

  it("reports a missing enum member with the expected and observed sets", async () => {
    const snapshot = completeSnapshot();
    const incomplete = {
      ...snapshot,
      enums: snapshot.enums.map((enumType) =>
        enumType.enum_name === "task_status"
          ? {
              ...enumType,
              enum_labels: enumType.enum_labels.filter(
                (label) => label !== "verifying",
              ),
            }
          : enumType,
      ),
    };

    const issues = findApplicationSchemaIssues(incomplete);
    assert.deepEqual(
      issues.filter((item) => item.kind === "incompatible_enum"),
      [
        {
          kind: "incompatible_enum",
          tableName: "public",
          objectName: "task_status",
          expected:
            "[pending, queued, running, verifying, completed, failed, cancelled]",
          actual: "[pending, queued, running, completed, failed, cancelled]",
        },
      ],
    );
    await assert.rejects(
      assertApplicationSchemaWithClient(clientFor(snapshot, incomplete)),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationSchemaError);
        assert.match(error.message, /task_status/);
        assert.match(error.message, /verifying/);
        assert.match(error.message, /schema:apply/);
        return true;
      },
    );
  });

  it("reports an unexpected enum member with the expected and observed sets", () => {
    const snapshot = completeSnapshot();
    const incompatible = {
      ...snapshot,
      enums: snapshot.enums.map((enumType) =>
        enumType.enum_name === "log_level"
          ? {
              ...enumType,
              enum_labels: [...enumType.enum_labels, "trace"],
            }
          : enumType,
      ),
    };

    const issues = findApplicationSchemaIssues(incompatible);
    assert.deepEqual(
      issues.filter((item) => item.kind === "incompatible_enum"),
      [
        {
          kind: "incompatible_enum",
          tableName: "public",
          objectName: "log_level",
          expected: "[debug, info, warn, error]",
          actual: "[debug, info, warn, error, trace]",
        },
      ],
    );
  });

  it("reports all enum mismatches together without changing the audit concern", () => {
    const snapshot = completeSnapshot();
    const incompatible = {
      ...snapshot,
      enums: snapshot.enums.map((enumType) => {
        if (enumType.enum_name === "task_status") {
          return {
            ...enumType,
            enum_labels: enumType.enum_labels.filter(
              (label) => label !== "cancelled",
            ),
          };
        }
        if (enumType.enum_name === "task_priority") {
          return {
            ...enumType,
            enum_labels: [...enumType.enum_labels, "p4"],
          };
        }
        return enumType;
      }),
    };

    assert.deepEqual(
      findApplicationSchemaIssues(incompatible)
        .filter((item) => item.kind === "incompatible_enum")
        .map((item) => item.objectName),
      ["task_status", "task_priority"],
    );
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

  it("reports a missing session-memory outbox table without cascading column noise", () => {
    const snapshot = completeSnapshot();
    const issues = findApplicationSchemaIssues({
      ...snapshot,
      tables: snapshot.tables.filter(
        (table) => table.table_name !== "ai_session_memory_outbox",
      ),
    });
    assert.deepEqual(
      issues.filter((item) => item.tableName === "public").map((item) => item.kind),
      ["missing_table"],
    );
    assert.equal(issues[0]?.objectName, "ai_session_memory_outbox");
  });

  it("reports missing modern memory columns", () => {
    const snapshot = completeSnapshot();
    const issues = findApplicationSchemaIssues({
      ...snapshot,
      columns: snapshot.columns.filter(
        (column) =>
          !(
            column.table_name === "ai_session_memories" &&
            ["provenance", "scope", "turn_id"].includes(column.column_name)
          ),
      ),
    });
    assert.deepEqual(
      issues
        .filter((item) => item.kind === "missing_column")
        .map((item) => `${item.tableName}.${item.objectName}`),
      [
        "ai_session_memories.scope",
        "ai_session_memories.turn_id",
        "ai_session_memories.provenance",
      ],
    );
  });

  it("reports incompatible memory and outbox defaults or types", () => {
    const snapshot = completeSnapshot();
    const issues = findApplicationSchemaIssues({
      ...snapshot,
      columns: snapshot.columns.map((column) => {
        if (
          column.table_name === "ai_session_memories" &&
          column.column_name === "relevance"
        ) {
          return { ...column, data_type: "double precision", udt_name: "float8" };
        }
        if (
          column.table_name === "ai_session_memory_outbox" &&
          column.column_name === "attempts"
        ) {
          return { ...column, column_default: "1" };
        }
        return column;
      }),
    });
    assert.deepEqual(
      issues
        .filter((item) => item.kind === "incompatible_column")
        .map((item) => `${item.tableName}.${item.objectName}`),
      ["ai_session_memories.relevance", "ai_session_memory_outbox.attempts"],
    );
  });

  it("reports missing memory indexes and foreign keys by their real tables", () => {
    const snapshot = completeSnapshot();
    const issues = findApplicationSchemaIssues({
      ...snapshot,
      indexes: snapshot.indexes.filter(
        (index) =>
          index.indexname !== "idx_ai_session_memories_project_scope" &&
          index.indexname !== "idx_ai_session_memory_outbox_next_attempt_at",
      ),
      foreignKeys: snapshot.foreignKeys.filter(
        (key) =>
          !(
            key.table_name === "ai_session_memory_outbox" &&
            key.column_name === "session_id"
          ),
      ),
    });
    assert.deepEqual(
      issues
        .filter(
          (item) =>
            item.kind === "missing_index" || item.kind === "missing_foreign_key",
        )
        .map((item) => `${item.kind}:${item.tableName}.${item.objectName}`),
      [
        "missing_index:ai_session_memories.idx_ai_session_memories_project_scope",
        "missing_index:ai_session_memory_outbox.idx_ai_session_memory_outbox_next_attempt_at",
        "missing_foreign_key:ai_session_memory_outbox.session_id",
      ],
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
    assert.deepEqual(result.enums, snapshot.enums);
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

  it("keeps compatible legacy memory rows representable after delivery", () => {
    const legacyMemory = {
      memoryType: "key_finding",
      content: "legacy",
      sourcePath: null,
      dedupeKey: null,
      semanticKind: null,
      scope: null,
      turnId: null,
      provenance: null,
      sourceReference: null,
      sourceRevision: null,
      confidence: null,
      confirmationStatus: null,
      freshnessStatus: null,
    };
    const nullableColumns = APPLICATION_SCHEMA_CONTRACT.tables.ai_session_memories
      .filter((column) => column.nullable)
      .map((column) => column.name);
    assert.ok(nullableColumns.includes("provenance"));
    assert.ok(nullableColumns.includes("turn_id"));
    assert.equal(legacyMemory.provenance, null);
    assert.equal(legacyMemory.turnId, null);
  });
});
