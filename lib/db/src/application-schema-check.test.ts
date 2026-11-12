import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryResultRow } from "pg";
import type { IndexContract } from "./application-schema-check.js";
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
    if (tableName === "plugin_runs") {
      if (columnName === "status") return "'pending'::text";
      if (columnName === "attempt_count") return "0";
      if (columnName === "max_attempts") return "3";
      if (columnName === "next_attempt_at") return "now()";
    }
    if (
      (tableName === "ai_agent_observations" ||
        tableName === "ai_world_facts" ||
        tableName === "ai_world_transitions") &&
      columnName === "task_scope"
    ) {
      return "'project'::text";
    }
    if (
      (tableName === "ai_agent_observations" ||
        tableName === "ai_world_facts" ||
        tableName === "ai_world_transitions") &&
      columnName === "environment_revision_key"
    ) {
      return "'unknown'::text";
    }
    if (
      (tableName === "ai_agent_observations" ||
        tableName === "ai_world_facts") &&
      columnName === "environment_freshness"
    ) {
      return "'unknown'::ai_agent_observation_freshness";
    }
    if (tableName === "ai_world_transitions" && columnName === "freshness") {
      return "'unknown'::ai_agent_observation_freshness";
    }
    if (tableName === "ai_agent_observations" && columnName === "provenance") {
      return "'SERVER_DERIVED'::text";
    }
    if (tableName === "ai_agent_episodes" && columnName === "state") {
      return "'created'::ai_agent_episode_state";
    }
    if (tableName === "project_plugin_bindings" && columnName === "enabled") {
      return "false";
    }
    if (
      tableName === "project_plugin_bindings" &&
      columnName === "configuration"
    ) {
      return "'{}'::jsonb";
    }
    if (tableName === "ai_agent_effects" && columnName === "status") {
      return "'pending'::ai_agent_effect_status";
    }
    if (tableName === "ai_world_facts" && columnName === "status") {
      return "'believed'::ai_world_fact_status";
    }
    if (tableName === "ai_world_transitions" && columnName === "status") {
      return "'pending'::ai_world_transition_status";
    }
    if (
      tableName === "ai_strategy_candidates" &&
      columnName === "evaluation_status"
    ) {
      return "'discovered'::ai_strategy_evaluation_status";
    }
    if (tableName === "projects" && columnName === "strategy_replay_opt_in") {
      return "false";
    }
    if (
      tableName === "ai_strategy_replay_case_runs" &&
      columnName === "attempt_number"
    ) {
      return "1";
    }
    if (
      tableName === "ai_strategy_replay_case_runs" &&
      columnName === "status"
    ) {
      return null;
    }
    if (tableName === "project_bootstrap_jobs" && columnName === "status") {
      return "'queued'::project_bootstrap_status";
    }
    if (tableName === "ai_general_chat_messages" && columnName === "status") {
      return "'completed'::ai_general_chat_message_status";
    }
    if (
      tableName === "ai_mission_handoffs" &&
      columnName === "dispatch_status"
    ) {
      return "'pending'::ai_mission_handoff_dispatch_status";
    }
    if (tableName === "preview_sessions" && columnName === "status") {
      return "'starting'::preview_session_status";
    }
    if (
      tableName === "preview_agent_nodes" &&
      columnName === "status"
    ) {
      return "'pending'::preview_agent_node_status";
    }
    if (
      tableName === "preview_agent_nodes" &&
      columnName === "key_version"
    ) {
      return "0";
    }
    if (tableName === "preview_sessions" && columnName === "id") {
      return "gen_random_uuid()";
    }
    if (tableName === "preview_sessions" && columnName === "state_version") {
      return "0";
    }
    if (tableName === "preview_build_jobs" && columnName === "status") {
      return "'queued'::preview_build_job_status";
    }
    if (
      tableName === "preview_build_jobs" &&
      [
        "input_artifact_gc_state",
        "output_artifact_gc_state",
      ].includes(columnName)
    ) {
      return "'active'::preview_artifact_gc_state";
    }
    if (
      tableName === "preview_build_jobs" &&
      [
        "input_artifact_provider",
        "output_artifact_provider",
      ].includes(columnName)
    ) {
      return "'s3'::preview_artifact_provider";
    }
    if (tableName === "preview_build_jobs" && columnName === "state_version") {
      return "0";
    }
    if (tableName === "project_bootstrap_jobs" && columnName === "attempt") {
      return "0";
    }
    if (
      tableName === "project_bootstrap_jobs" &&
      columnName === "max_attempts"
    ) {
      return "3";
    }
    if (tableName === "ai_general_chat_sessions" && columnName === "title") {
      return "'New conversation'::text";
    }
    if (
      tableName === "ai_general_chat_rate_limits" &&
      columnName === "call_count"
    ) {
      return "1";
    }
    if (columnName === "status") return "'pending'::task_status";
    if (columnName === "priority") return "'p2'::task_priority";
    if (columnName === "level") return "'info'::log_level";
    if (
      (tableName === "tasks" &&
        (columnName === "related_files" || columnName === "depends_on")) ||
      (tableName === "ai_session_memory_outbox" &&
        (columnName === "tool_sources" || columnName === "semantic_records")) ||
      (tableName === "ai_agent_episodes" &&
        [
          "observation_refs",
          "action_refs",
          "expected_effect_refs",
          "observed_effect_refs",
          "evidence_refs",
        ].includes(columnName)) ||
      (tableName === "ai_agent_observations" &&
        ["source_refs", "evidence_refs"].includes(columnName)) ||
      (tableName === "ai_agent_effects" &&
        [
          "before_observation_ids",
          "after_observation_ids",
          "missing_effects",
          "contradiction_refs",
          "evidence_refs",
        ].includes(columnName)) ||
      (tableName === "ai_world_facts" &&
        columnName === "source_observation_ids") ||
      (tableName === "ai_world_transitions" &&
        [
          "before_observation_ids",
          "after_observation_ids",
          "materialized_observation_ids",
          "parent_fact_refs",
          "changed_fact_refs",
          "evidence_refs",
        ].includes(columnName)) ||
      (tableName === "ai_strategy_candidates" &&
        ["supporting_episode_ids", "contradicting_episode_ids"].includes(
          columnName,
        ))
    ) {
      return "'[]'::jsonb";
    }
    if (
      columnName === "retry_count" ||
      columnName === "attempts" ||
      columnName === "read_metadata_version" ||
      (tableName === "openrouter_lane_cursors" && columnName === "next_slot")
    )
      return "0";
    if (columnName === "max_retries") return "3";
    if (columnName === "relevance") return "1.0";
    if (
      tableName === "ai_execution_evidence_snapshots" &&
      ["complete", "read_count", "total_bytes"].includes(columnName)
    )
      return "0";
    if (
      tableName === "ai_execution_evidence_reads" &&
      columnName === "read_type"
    )
      return "'source'::text";
    if (
      tableName === "ai_execution_evidence_reads" &&
      columnName === "complete"
    )
      return "1";
    if (
      tableName === "ai_execution_evidence_reads" &&
      columnName === "truncated"
    )
      return "0";
    if (
      tableName === "ai_execution_acceptances" &&
      ["evidence_required", "evidence_complete", "resumable"].includes(
        columnName,
      )
    )
      return "0";
    if (
      columnName === "created_at" ||
      columnName === "updated_at" ||
      columnName === "timestamp" ||
      (tableName === "ai_agent_shadow_campaign_events" &&
        columnName === "occurred_at")
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
  const indexes = (
    APPLICATION_SCHEMA_CONTRACT.indexes as readonly IndexContract[]
  ).map((definition) => ({
    tablename: definition.tableName,
    indexname: definition.name,
    access_method: definition.accessMethod ?? "btree",
    is_unique: Boolean(definition.unique),
    is_valid: true,
    predicate:
      definition.predicate ??
      (definition.predicatePattern
        ? "status = ANY (ARRAY['pending'::preview_agent_node_status, 'active'::preview_agent_node_status])"
        : null),
    columns: [...definition.columns],
  }));
  const requiredTables = [
    ...new Set([
      ...Object.keys(APPLICATION_SCHEMA_CONTRACT.tables),
      ...(APPLICATION_SCHEMA_CONTRACT.indexes as readonly IndexContract[]).map(
        (index) => index.tableName,
      ),
    ]),
  ];
  return {
    tables: requiredTables.map((table_name) => ({
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
    primaryKeys: requiredTables.flatMap((table_name) =>
      table_name === "startup_maintenance_state"
        ? ["maintenance_key"].map((column_name) => ({
            table_name,
            column_name,
          }))
        : table_name === "openrouter_model_cooldowns"
          ? ["provider", "model"].map((column_name) => ({
              table_name,
              column_name,
            }))
          : table_name === "openrouter_catalog_snapshots"
            ? ["catalog_key"].map((column_name) => ({
                table_name,
                column_name,
              }))
            : table_name === "openrouter_lane_cursors"
              ? ["cursor_key", "candidate_set_hash"].map((column_name) => ({
                  table_name,
                  column_name,
                }))
              : table_name === "openrouter_credential_cooldowns"
                ? ["credential_fingerprint"].map((column_name) => ({
                    table_name,
                    column_name,
                  }))
                : table_name === "ai_general_chat_rate_limits"
                  ? ["owner_id", "window_bucket"].map((column_name) => ({
                      table_name,
                      column_name,
                    }))
                  : table_name === "preview_build_jobs"
                    ? ["job_id"].map((column_name) => ({
                        table_name,
                        column_name,
                      }))
                    : table_name === "preview_access_tickets"
                      ? ["ticket_digest"].map((column_name) => ({
                          table_name,
                          column_name,
                        }))
                      : [{ table_name, column_name: "id" }],
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
      if (sql.includes("FROM pg_index")) {
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
      issues
        .filter((item) => item.tableName === "public")
        .map((item) => item.kind),
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

  it("reports missing AI telemetry contract and rate-limit columns", () => {
    const snapshot = completeSnapshot();
    const missingColumns = [
      "contract_failure_kind",
      "rate_limit_scope",
      "retry_after_ms",
    ];
    const issues = findApplicationSchemaIssues({
      ...snapshot,
      columns: snapshot.columns.filter(
        (column) =>
          !(
            column.table_name === "ai_usage_events" &&
            missingColumns.includes(column.column_name)
          ),
      ),
    });
    assert.deepEqual(
      issues
        .filter(
          (item) =>
            item.kind === "missing_column" &&
            item.tableName === "ai_usage_events",
        )
        .map((item) => item.objectName),
      missingColumns,
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
          return {
            ...column,
            data_type: "double precision",
            udt_name: "float8",
          };
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
            item.kind === "missing_index" ||
            item.kind === "missing_foreign_key",
        )
        .map((item) => `${item.kind}:${item.tableName}.${item.objectName}`),
      [
        "missing_index:ai_session_memories.idx_ai_session_memories_project_scope",
        "missing_index:ai_session_memory_outbox.idx_ai_session_memory_outbox_next_attempt_at",
        "missing_foreign_key:ai_session_memory_outbox.session_id",
      ],
    );
  });

  it("rejects incorrect table, method, uniqueness, predicate, and key order", () => {
    const snapshot = completeSnapshot();
    const indexName = "uq_ai_execution_acceptances_execution_attempt";
    const expectedIndex = snapshot.indexes.find(
      (index) => index.indexname === indexName,
    );
    assert.ok(expectedIndex);
    const invalidRows = [
      { ...expectedIndex, tablename: "ai_executions" },
      { ...expectedIndex, access_method: "hash" },
      { ...expectedIndex, is_unique: false },
      { ...expectedIndex, is_valid: false },
      { ...expectedIndex, predicate: "attempt >= 0" },
      { ...expectedIndex, columns: [...expectedIndex.columns].reverse() },
    ];

    for (const invalidRow of invalidRows) {
      const issues = findApplicationSchemaIssues({
        ...snapshot,
        indexes: snapshot.indexes.map((index) =>
          index.indexname === indexName ? invalidRow : index,
        ),
      });
      assert.ok(
        issues.some(
          (item) =>
            item.kind === "incompatible_index" && item.objectName === indexName,
        ),
        "schema validation must compare the complete index contract",
      );
    }
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

  it("requires the Preview session UUID default and ticket-digest primary key", () => {
    const snapshot = completeSnapshot();
    const withoutUuidDefault = findApplicationSchemaIssues({
      ...snapshot,
      columns: snapshot.columns.map((column) =>
        column.table_name === "preview_sessions" && column.column_name === "id"
          ? { ...column, column_default: null }
          : column,
      ),
    });
    assert.ok(
      withoutUuidDefault.some(
        (item) =>
          item.kind === "incompatible_column" &&
          item.tableName === "preview_sessions" &&
          item.objectName === "id",
      ),
    );

    const withoutTicketDigestPrimaryKey = findApplicationSchemaIssues({
      ...snapshot,
      primaryKeys: snapshot.primaryKeys.filter(
        (key) => key.table_name !== "preview_access_tickets",
      ),
    });
    assert.ok(
      withoutTicketDigestPrimaryKey.some(
        (item) =>
          item.kind === "missing_primary_key" &&
          item.tableName === "preview_access_tickets" &&
          item.objectName === "ticket_digest",
      ),
    );

    const withoutBuildReceiptFence = findApplicationSchemaIssues({
      ...snapshot,
      indexes: snapshot.indexes.filter(
        (index) => index.indexname !== "uq_preview_sessions_build_receipt_id",
      ),
    });
    assert.ok(
      withoutBuildReceiptFence.some(
        (item) =>
          item.kind === "missing_index" &&
          item.tableName === "preview_sessions" &&
          item.objectName === "uq_preview_sessions_build_receipt_id",
      ),
    );

    const withoutBuildOutputBinding = findApplicationSchemaIssues({
      ...snapshot,
      columns: snapshot.columns.filter(
        (column) =>
          !(
            column.table_name === "preview_sessions" &&
            ["build_output_artifact_key", "build_output_digest"].includes(
              column.column_name,
            )
          ),
      ),
    });
    assert.deepEqual(
      withoutBuildOutputBinding
        .filter(
          (item) =>
            item.kind === "missing_column" &&
            item.tableName === "preview_sessions",
        )
        .map((item) => item.objectName)
        .sort(),
      ["build_output_artifact_key", "build_output_digest"],
    );

    const withoutBuildJobLink = findApplicationSchemaIssues({
      ...snapshot,
      columns: snapshot.columns.filter(
        (column) =>
          !(
            column.table_name === "preview_sessions" &&
            column.column_name === "build_job_id"
          ),
      ),
      indexes: snapshot.indexes.filter(
        (index) => index.indexname !== "uq_preview_sessions_build_job_id",
      ),
      foreignKeys: snapshot.foreignKeys.filter(
        (key) =>
          !(
            key.table_name === "preview_sessions" &&
            key.column_name === "build_job_id"
          ),
      ),
    });
    assert.ok(
      withoutBuildJobLink.some(
        (issue) =>
          issue.kind === "missing_column" &&
          issue.tableName === "preview_sessions" &&
          issue.objectName === "build_job_id",
      ),
    );
    assert.ok(
      withoutBuildJobLink.some(
        (issue) =>
          issue.kind === "missing_index" &&
          issue.tableName === "preview_sessions" &&
          issue.objectName === "uq_preview_sessions_build_job_id",
      ),
    );
    assert.ok(
      withoutBuildJobLink.some(
        (issue) =>
          issue.kind === "missing_foreign_key" &&
          issue.tableName === "preview_sessions" &&
          issue.objectName === "build_job_id",
      ),
    );
  });

  it("requires the separate durable Preview build-job state and idempotency fence", () => {
    const snapshot = completeSnapshot();
    const withoutJobRequestFence = findApplicationSchemaIssues({
      ...snapshot,
      indexes: snapshot.indexes.filter(
        (index) => index.indexname !== "uq_preview_build_jobs_request",
      ),
    });
    assert.ok(
      withoutJobRequestFence.some(
        (issue) =>
          issue.kind === "missing_index" &&
          issue.tableName === "preview_build_jobs" &&
          issue.objectName === "uq_preview_build_jobs_request",
      ),
    );

    const withoutVerifiedReceipt = findApplicationSchemaIssues({
      ...snapshot,
      columns: snapshot.columns.filter(
        (column) =>
          !(
            column.table_name === "preview_build_jobs" &&
            column.column_name === "build_receipt_id"
          ),
      ),
    });
    assert.ok(
      withoutVerifiedReceipt.some(
        (issue) =>
          issue.kind === "missing_column" &&
          issue.tableName === "preview_build_jobs" &&
          issue.objectName === "build_receipt_id",
      ),
    );

    const withoutVerifiedState = findApplicationSchemaIssues({
      ...snapshot,
      enums: snapshot.enums.map((entry) =>
        entry.enum_name === "preview_build_job_status"
          ? {
              ...entry,
              enum_labels: entry.enum_labels.filter(
                (label) => label !== "verified",
              ),
            }
          : entry,
      ),
    });
    assert.ok(
      withoutVerifiedState.some(
        (issue) =>
          issue.kind === "incompatible_enum" &&
          issue.objectName === "preview_build_job_status",
      ),
    );
  });

  it("requires a project-scoped Preview Agent key registry", () => {
    const snapshot = completeSnapshot();
    const missingFingerprintFence = findApplicationSchemaIssues({
      ...snapshot,
      indexes: snapshot.indexes.filter(
        (index) =>
          index.indexname !==
          "uq_preview_agent_nodes_public_key_fingerprint",
      ),
    });
    assert.ok(
      missingFingerprintFence.some(
        (issue) =>
          issue.kind === "missing_index" &&
          issue.tableName === "preview_agent_nodes" &&
          issue.objectName ===
            "uq_preview_agent_nodes_public_key_fingerprint",
      ),
    );
    const incorrectLiveStorePredicate = findApplicationSchemaIssues({
      ...snapshot,
      indexes: snapshot.indexes.map((index) =>
        index.indexname === "uq_preview_agent_nodes_live_store"
          ? { ...index, predicate: "status = 'active'::preview_agent_node_status" }
          : index,
      ),
    });
    assert.ok(
      incorrectLiveStorePredicate.some(
        (issue) =>
          issue.kind === "incompatible_index" &&
          issue.tableName === "preview_agent_nodes" &&
          issue.objectName === "uq_preview_agent_nodes_live_store",
      ),
    );

    const missingProjectOwnership = findApplicationSchemaIssues({
      ...snapshot,
      foreignKeys: snapshot.foreignKeys.filter(
        (key) =>
          !(
            key.table_name === "preview_agent_nodes" &&
            key.column_name === "project_id"
          ),
      ),
    });
    assert.ok(
      missingProjectOwnership.some(
        (issue) =>
          issue.kind === "missing_foreign_key" &&
          issue.tableName === "preview_agent_nodes" &&
          issue.objectName === "project_id",
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
    const nullableColumns =
      APPLICATION_SCHEMA_CONTRACT.tables.ai_session_memories
        .filter((column) => column.nullable)
        .map((column) => column.name);
    assert.ok(nullableColumns.includes("provenance"));
    assert.ok(nullableColumns.includes("turn_id"));
    assert.equal(legacyMemory.provenance, null);
    assert.equal(legacyMemory.turnId, null);
  });
});
