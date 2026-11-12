import type { QueryResultRow } from "pg";
import { pool } from "./index.js";

type SchemaQueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

export type ApplicationSchemaIssueKind =
  | "missing_table"
  | "missing_primary_key"
  | "missing_column"
  | "incompatible_column"
  | "incompatible_enum"
  | "missing_index"
  | "incompatible_index"
  | "missing_foreign_key";

export interface ApplicationSchemaIssue {
  kind: ApplicationSchemaIssueKind;
  tableName: string;
  objectName: string;
  expected: string;
  actual?: string;
}

type ColumnContract = {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  defaultExpression?: RegExp;
};

export type IndexContract = {
  name: string;
  tableName: string;
  columns: readonly string[];
  unique?: boolean;
  accessMethod?: string;
  predicate?: string | null;
  predicatePattern?: RegExp;
};

type ForeignKeyContract = {
  tableName: string;
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
  deleteRule: string;
};

type EnumRow = {
  enum_name: string;
  enum_labels: string[];
};

/**
 * This is the release-critical subset of the Drizzle schema. Keep this list
 * alongside tasks.ts and task_logs.ts: it describes the database properties
 * that the API reads and writes, not the JSON shape inside remediation_plan.
 */
export const APPLICATION_SCHEMA_CONTRACT = {
  tables: {
    startup_maintenance_state: [
      {
        name: "maintenance_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "cursor_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      { name: "cursor_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "completed_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      {
        name: "updated_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    openrouter_model_cooldowns: [
      { name: "provider", dataType: "text", udtName: "text", nullable: false },
      { name: "model", dataType: "text", udtName: "text", nullable: false },
      {
        name: "cooling_until",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
      },
      {
        name: "updated_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    openrouter_catalog_snapshots: [
      {
        name: "catalog_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "snapshot", dataType: "jsonb", udtName: "jsonb", nullable: true },
      {
        name: "refreshed_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      {
        name: "expires_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      {
        name: "failure_backoff_until",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      {
        name: "last_failure_code",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "lease_token",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "lease_expires_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      {
        name: "updated_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    openrouter_lane_cursors: [
      {
        name: "cursor_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "candidate_set_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "next_slot",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /0/,
      },
      {
        name: "updated_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    openrouter_credential_cooldowns: [
      {
        name: "credential_fingerprint",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "cooling_until",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
      },
      {
        name: "error_code",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "scope", dataType: "text", udtName: "text", nullable: false },
      {
        name: "updated_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    projects: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "strategy_replay_opt_in",
        dataType: "boolean",
        udtName: "bool",
        nullable: false,
        defaultExpression: /false/,
      },
    ] satisfies readonly ColumnContract[],
    project_bootstrap_jobs: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      { name: "owner_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "idempotency_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "name", dataType: "text", udtName: "text", nullable: false },
      {
        name: "description",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "template_version",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "project_bootstrap_status",
        nullable: false,
        defaultExpression: /'queued'::project_bootstrap_status/,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /0/,
      },
      {
        name: "max_attempts",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /3/,
      },
      { name: "worker_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "lease_until",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "last_heartbeat_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "working_root_path",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "project_id", dataType: "text", udtName: "text", nullable: true },
      { name: "error_code", dataType: "text", udtName: "text", nullable: true },
      {
        name: "error_message",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      },
      {
        name: "started_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "finished_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
    ] as readonly ColumnContract[],
    ai_general_chat_sessions: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      { name: "owner_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "title",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /new.*conversation/i,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      },
    ] as readonly ColumnContract[],
    ai_general_chat_messages: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "session_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "turn_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "role",
        dataType: "USER-DEFINED",
        udtName: "ai_general_chat_message_role",
        nullable: false,
      },
      { name: "content", dataType: "text", udtName: "text", nullable: false },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "ai_general_chat_message_status",
        nullable: false,
        defaultExpression: /'completed'::ai_general_chat_message_status/,
      },
      { name: "worker_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "lease_until",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      { name: "error_code", dataType: "text", udtName: "text", nullable: true },
      {
        name: "error_message",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      },
    ] as readonly ColumnContract[],
    ai_general_chat_rate_limits: [
      { name: "owner_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "window_bucket",
        dataType: "bigint",
        udtName: "int8",
        nullable: false,
      },
      {
        name: "call_count",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /1/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      },
    ] as readonly ColumnContract[],
    project_plugin_bindings: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "plugin_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "enabled",
        dataType: "boolean",
        udtName: "bool",
        nullable: false,
        defaultExpression: /false/,
      },
      {
        name: "configuration",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\{\}'::jsonb/,
      },
      {
        name: "approved_by",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    plugin_dispatch_batches: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "scan_job_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "context", dataType: "jsonb", udtName: "jsonb", nullable: false },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      },
    ] as readonly ColumnContract[],
    plugin_runs: [
      ...["id", "dispatch_id", "plugin_id", "plugin_version"].map((name) => ({
        name,
        dataType: "text",
        udtName: "text",
        nullable: false,
      })),
      {
        name: "status",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /^'pending'::text$/,
      },
      {
        name: "attempt_count",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /^0$/,
      },
      {
        name: "max_attempts",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /^3$/,
      },
      ...["worker_id", "last_error_code"].map((name) => ({
        name,
        dataType: "text",
        udtName: "text",
        nullable: true,
      })),
      ...["next_attempt_at", "created_at", "updated_at"].map((name) => ({
        name,
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /now\(\)/,
      })),
      ...["lease_until", "started_at", "finished_at"].map((name) => ({
        name,
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      })),
      {
        name: "result_events",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: true,
      },
    ] as readonly ColumnContract[],
    workspace_runtime: [
      {
        name: "environment_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "attestation_binding",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: true,
      },
      {
        name: "attestation_key_version",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
    ] as readonly ColumnContract[],
    preview_sessions: [
      {
        name: "id",
        dataType: "uuid",
        udtName: "uuid",
        nullable: false,
        defaultExpression: /gen_random_uuid\(\)/,
      },
      {
        name: "proposal_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "user_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "proposal_revision",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "candidate_revision",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "change_set_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "image_digest",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "task_definition_arn",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "build_job_id",
        dataType: "uuid",
        udtName: "uuid",
        nullable: true,
      },
      {
        name: "build_receipt_id",
        dataType: "uuid",
        udtName: "uuid",
        nullable: true,
      },
      {
        name: "build_output_artifact_key",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "build_output_digest",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "preview_session_status",
        nullable: false,
        defaultExpression: /'starting'::preview_session_status/,
      },
      {
        name: "runner_task_arn",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "state_version",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /0/,
      },
      {
        name: "expires_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
      },
      {
        name: "ready_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      {
        name: "closed_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] as readonly ColumnContract[],
    preview_build_jobs: [
      { name: "job_id", dataType: "uuid", udtName: "uuid", nullable: false },
      {
        name: "build_id",
        dataType: "uuid",
        udtName: "uuid",
        nullable: false,
      },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "proposal_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "user_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "client_request_id",
        dataType: "uuid",
        udtName: "uuid",
        nullable: false,
      },
      ...[
        "operation_id",
        "candidate_revision",
        "change_set_hash",
        "source_root",
        "source_digest",
        "archive_digest",
        "input_artifact_key",
        "output_artifact_key",
        "builder_image_digest",
      ].map((name) => ({
        name,
        dataType: "text",
        udtName: "text",
        nullable: false,
      })),
      ...[
        "input_artifact_ready_at",
        "input_artifact_gc_marked_at",
        "output_artifact_gc_marked_at",
      ].map((name) => ({
        name,
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      })),
      ...["input_artifact_gc_state", "output_artifact_gc_state"].map(
        (name) => ({
          name,
          dataType: "USER-DEFINED",
          udtName: "preview_artifact_gc_state",
          nullable: false,
          defaultExpression: /'active'::preview_artifact_gc_state/,
        }),
      ),
      ...["input_artifact_provider", "output_artifact_provider"].map(
        (name) => ({
          name,
          dataType: "USER-DEFINED",
          udtName: "preview_artifact_provider",
          nullable: false,
          defaultExpression: /'s3'::preview_artifact_provider/,
        }),
      ),
      {
        name: "proposal_revision",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      ...["issued_at", "token_expires_at"].map((name) => ({
        name,
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
      })),
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "preview_build_job_status",
        nullable: false,
        defaultExpression: /'queued'::preview_build_job_status/,
      },
      ...["builder_task_arn", "output_digest", "failure_code"].map((name) => ({
        name,
        dataType: "text",
        udtName: "text",
        nullable: true,
      })),
      {
        name: "build_receipt_id",
        dataType: "uuid",
        udtName: "uuid",
        nullable: true,
      },
      {
        name: "state_version",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /0/,
      },
      ...["started_at", "completed_at"].map((name) => ({
        name,
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      })),
      ...["created_at", "updated_at"].map((name) => ({
        name,
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      })),
    ] as readonly ColumnContract[],
    preview_access_tickets: [
      {
        name: "ticket_digest",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "user_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "preview_session_id",
        dataType: "uuid",
        udtName: "uuid",
        nullable: false,
      },
      {
        name: "proposal_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "proposal_revision",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "candidate_revision",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "change_set_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "issued_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
      },
      {
        name: "expires_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
      },
      {
        name: "consumed_at",
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      },
    ] as readonly ColumnContract[],
    preview_agent_nodes: [
      { name: "node_id", dataType: "uuid", udtName: "uuid", nullable: false },
      { name: "project_id", dataType: "text", udtName: "text", nullable: false },
      { name: "user_id", dataType: "text", udtName: "text", nullable: false },
      { name: "store_id", dataType: "uuid", udtName: "uuid", nullable: false },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "preview_agent_node_status",
        nullable: false,
        defaultExpression: /'pending'::preview_agent_node_status/,
      },
      ...["pairing_code_hash", "public_key_pem", "public_key_fingerprint", "agent_version", "platform", "capability_report_token"].map((name) => ({
        name,
        dataType: "text",
        udtName: "text",
        nullable: true,
      })),
      ...["pairing_expires_at", "capability_expires_at", "paired_at", "last_seen_at", "revoked_at"].map((name) => ({
        name,
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: true,
      })),
      {
        name: "key_version",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /0/,
      },
      ...["created_at", "updated_at"].map((name) => ({
        name,
        dataType: "timestamp with time zone",
        udtName: "timestamptz",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      })),
    ] as readonly ColumnContract[],
    // Mission Control's usage summary reads contract failure categories from
    // this table, so a stale telemetry schema must fail before the route does.
    ai_usage_events: [
      {
        name: "contract_failure_kind",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "rate_limit_scope",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "retry_after_ms",
        dataType: "bigint",
        udtName: "int8",
        nullable: true,
      },
    ] as readonly ColumnContract[],
    ai_execution_evidence_snapshots: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "operation_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "source_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "candidate_identity",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "verdict", dataType: "text", udtName: "text", nullable: false },
      {
        name: "complete",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "read_count",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "total_bytes",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_execution_evidence_reads: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "snapshot_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "path", dataType: "text", udtName: "text", nullable: false },
      {
        name: "read_type",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'source'::text/,
      },
      {
        name: "read_metadata_version",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "line_start",
        dataType: "integer",
        udtName: "int4",
        nullable: true,
      },
      {
        name: "line_end",
        dataType: "integer",
        udtName: "int4",
        nullable: true,
      },
      {
        name: "content_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "byte_length",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "complete",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])1(?:[^0-9]|$)/,
      },
      {
        name: "truncated",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      { name: "body", dataType: "text", udtName: "text", nullable: false },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_execution_acceptances: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "finalization_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "operation_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "worker_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "terminal_status",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "outcome", dataType: "text", udtName: "text", nullable: false },
      {
        name: "reason_code",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "next_action_code",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "disposition",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: true,
      },
      {
        name: "evidence_snapshot_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "evidence_required",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "evidence_complete",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "resumable",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      { name: "message_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "source_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "candidate_identity",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "effect_bundle_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_agent_episodes: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      { name: "mission_id", dataType: "text", udtName: "text", nullable: true },
      { name: "goal_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "parent_episode_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "project_revision",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "environment_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "world_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "belief_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "plan_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "intent_kind",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "scope", dataType: "jsonb", udtName: "jsonb", nullable: false },
      {
        name: "objective_contract_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "observation_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "action_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "expected_effect_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "observed_effect_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "evidence_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "state",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_episode_state",
        nullable: false,
        defaultExpression: /'created'::ai_agent_episode_state/,
      },
      {
        name: "verdict",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_episode_verdict",
        nullable: true,
      },
      {
        name: "reason_code",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "next_action_code",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "worker_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "lease_until",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
      },
      {
        name: "idempotency_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "closed_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
    ] satisfies readonly ColumnContract[],
    ai_agent_episode_events: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "episode_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "sequence",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "event_type",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_episode_event_type",
        nullable: false,
      },
      { name: "payload", dataType: "jsonb", udtName: "jsonb", nullable: false },
      {
        name: "payload_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "actor_type",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_episode_actor_type",
        nullable: false,
      },
      { name: "actor_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "correlation_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_agent_observations: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "episode_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "task_scope",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'project'::text/,
      },
      {
        name: "environment_revision_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'unknown'::text/,
      },
      { name: "kind", dataType: "text", udtName: "text", nullable: false },
      {
        name: "provenance",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'server_derived'::text/,
      },
      {
        name: "observation_role",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "source_type",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "source_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "source_version",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "subject", dataType: "text", udtName: "text", nullable: false },
      { name: "predicate", dataType: "text", udtName: "text", nullable: false },
      { name: "value", dataType: "jsonb", udtName: "jsonb", nullable: false },
      {
        name: "value_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "source_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "observed_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
      },
      {
        name: "project_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "environment_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "completeness",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_observation_completeness",
        nullable: false,
      },
      {
        name: "freshness",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_observation_freshness",
        nullable: false,
      },
      {
        name: "environment_freshness",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_observation_freshness",
        nullable: false,
        defaultExpression: /'unknown'::ai_agent_observation_freshness/,
      },
      {
        name: "evidence_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "sequence",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_agent_effects: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "episode_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      { name: "action_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "capability_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "effect_contract_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "before_observation_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "after_observation_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "expected_effects",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
      },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_effect_status",
        nullable: false,
        defaultExpression: /'pending'::ai_agent_effect_status/,
      },
      {
        name: "missing_effects",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "contradiction_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "evidence_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_agent_effect_bundles: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "episode_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "effect_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
      },
      {
        name: "effect_contract_hashes",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
      },
      { name: "verdict", dataType: "text", udtName: "text", nullable: false },
      {
        name: "world_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_agent_shadow_campaign_events: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "campaign_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "idempotency_key_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "outcome",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_shadow_campaign_outcome",
        nullable: false,
      },
      {
        name: "failure_code",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "latency_ms",
        dataType: "integer",
        udtName: "int4",
        nullable: true,
      },
      {
        name: "occurred_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_world_facts: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "task_scope",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'project'::text/,
      },
      {
        name: "environment_revision_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'unknown'::text/,
      },
      { name: "subject", dataType: "text", udtName: "text", nullable: false },
      { name: "predicate", dataType: "text", udtName: "text", nullable: false },
      { name: "value", dataType: "jsonb", udtName: "jsonb", nullable: false },
      {
        name: "value_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "version",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "ai_world_fact_status",
        nullable: false,
        defaultExpression: /'believed'::ai_world_fact_status/,
      },
      {
        name: "source_observation_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "project_revision",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "environment_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "environment_freshness",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_observation_freshness",
        nullable: false,
        defaultExpression: /'unknown'::ai_agent_observation_freshness/,
      },
      {
        name: "supersedes_fact_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_world_transitions: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "episode_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "action_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "effect_bundle_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "parent_world_revision",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "resulting_world_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "task_scope",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'project'::text/,
      },
      {
        name: "environment_revision_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
        defaultExpression: /'unknown'::text/,
      },
      {
        name: "environment_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "freshness",
        dataType: "USER-DEFINED",
        udtName: "ai_agent_observation_freshness",
        nullable: false,
        defaultExpression: /'unknown'::ai_agent_observation_freshness/,
      },
      {
        name: "before_observation_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "after_observation_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "materialized_observation_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "parent_fact_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "changed_fact_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "evidence_refs",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "ai_world_transition_status",
        nullable: false,
        defaultExpression: /'pending'::ai_world_transition_status/,
      },
      {
        name: "idempotency_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "retry_count",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /0/,
      },
      {
        name: "failure_code",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "next_retry_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "materialized_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_strategy_candidates: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "strategy_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "version",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
      },
      {
        name: "candidate",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
      },
      {
        name: "candidate_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "confidence",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "supporting_episode_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "contradicting_episode_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "evaluation_status",
        dataType: "USER-DEFINED",
        udtName: "ai_strategy_evaluation_status",
        nullable: false,
        defaultExpression: /'discovered'::ai_strategy_evaluation_status/,
      },
      {
        name: "source_revision",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_strategy_replay_cases: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "candidate_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "source_episode_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "case_definition",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_strategy_replay_case_runs: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "case_registration_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "attempt_number",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /^1$/,
      },
      {
        name: "candidate_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "source_episode_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "operation_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "candidate_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "source_canonical_proof_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "status", dataType: "text", udtName: "text", nullable: false },
      {
        name: "replay_execution_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "replay_episode_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "replay_attempt",
        dataType: "integer",
        udtName: "int4",
        nullable: true,
      },
      {
        name: "replay_effect_bundle_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "replay_canonical_proof_hash",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "workspace_tree_hash",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "receipt", dataType: "jsonb", udtName: "jsonb", nullable: true },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    tasks: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "rule_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "workflow_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "title", dataType: "text", udtName: "text", nullable: false },
      {
        name: "description",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "task_status",
        nullable: false,
        defaultExpression: /'pending'::task_status/,
      },
      {
        name: "priority",
        dataType: "USER-DEFINED",
        udtName: "task_priority",
        nullable: false,
        defaultExpression: /'p2'::task_priority/,
      },
      {
        name: "related_files",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "depends_on",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "retry_count",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "max_retries",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])3(?:[^0-9]|$)/,
      },
      { name: "phase", dataType: "text", udtName: "text", nullable: true },
      { name: "prompt", dataType: "text", udtName: "text", nullable: true },
      {
        name: "agent_response",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "verification_result",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: true,
      },
      // Explicitly nullable: old and generic tasks have no remediation plan.
      {
        name: "remediation_plan",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "completed_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "correlation_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "worker_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "lease_until",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "last_heartbeat_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "idempotency_key",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
    ] satisfies readonly ColumnContract[],
    task_logs: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      { name: "task_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "level",
        dataType: "USER-DEFINED",
        udtName: "log_level",
        nullable: false,
        defaultExpression: /'info'::log_level/,
      },
      { name: "message", dataType: "text", udtName: "text", nullable: false },
      { name: "metadata", dataType: "jsonb", udtName: "jsonb", nullable: true },
      {
        name: "timestamp",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "correlation_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "event_type", dataType: "text", udtName: "text", nullable: true },
      {
        name: "execution_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      { name: "attempt", dataType: "integer", udtName: "int4", nullable: true },
      {
        name: "sequence",
        dataType: "integer",
        udtName: "int4",
        nullable: true,
      },
      {
        name: "progress_stage",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "progress_status",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "progress_percent",
        dataType: "integer",
        udtName: "int4",
        nullable: true,
      },
      {
        name: "progress_message",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "started_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "finished_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "terminal_outcome",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
    ] satisfies readonly ColumnContract[],
    ai_session_memories: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "session_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "memory_type",
        dataType: "USER-DEFINED",
        udtName: "ai_memory_type",
        nullable: false,
      },
      { name: "content", dataType: "text", udtName: "text", nullable: false },
      {
        name: "source_path",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "dedupe_key",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "semantic_kind",
        dataType: "USER-DEFINED",
        udtName: "ai_semantic_memory_kind",
        nullable: true,
      },
      { name: "scope", dataType: "text", udtName: "text", nullable: true },
      { name: "turn_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "provenance",
        dataType: "USER-DEFINED",
        udtName: "ai_semantic_memory_provenance",
        nullable: true,
      },
      {
        name: "source_reference",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "source_revision",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "confidence",
        dataType: "real",
        udtName: "float4",
        nullable: true,
      },
      {
        name: "confirmation_status",
        dataType: "USER-DEFINED",
        udtName: "ai_semantic_memory_confirmation",
        nullable: true,
      },
      {
        name: "freshness_status",
        dataType: "USER-DEFINED",
        udtName: "ai_semantic_memory_freshness",
        nullable: true,
      },
      {
        name: "relevance",
        dataType: "real",
        udtName: "float4",
        nullable: false,
        defaultExpression: /^1(?:\.0+)?(?:::[a-z ]+)?$/,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "expires_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "last_decay_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
    ] satisfies readonly ColumnContract[],
    ai_session_memory_outbox: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "session_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "turn_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "tool_sources",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "response_text",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "semantic_records",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
        defaultExpression: /'\[\]'::jsonb/,
      },
      {
        name: "attempts",
        dataType: "integer",
        udtName: "int4",
        nullable: false,
        defaultExpression: /(?:^|[^0-9])0(?:[^0-9]|$)/,
      },
      {
        name: "next_attempt_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
    ai_mission_handoffs: [
      { name: "id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "project_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "user_id", dataType: "text", udtName: "text", nullable: false },
      {
        name: "mission_id",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "session_id", dataType: "text", udtName: "text", nullable: true },
      { name: "message_id", dataType: "text", udtName: "text", nullable: true },
      {
        name: "assistant_message_id",
        dataType: "text",
        udtName: "text",
        nullable: true,
      },
      {
        name: "idempotency_key",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      {
        name: "request_hash",
        dataType: "text",
        udtName: "text",
        nullable: false,
      },
      { name: "plan_hash", dataType: "text", udtName: "text", nullable: false },
      { name: "preview", dataType: "jsonb", udtName: "jsonb", nullable: false },
      {
        name: "activation_plan",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
      },
      {
        name: "dispatch_goal_ids",
        dataType: "jsonb",
        udtName: "jsonb",
        nullable: false,
      },
      {
        name: "dispatch_status",
        dataType: "USER-DEFINED",
        udtName: "ai_mission_handoff_dispatch_status",
        nullable: false,
        defaultExpression: /'pending'::ai_mission_handoff_dispatch_status/,
      },
      {
        name: "dispatched_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: true,
      },
      {
        name: "created_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
      {
        name: "updated_at",
        dataType: "timestamp without time zone",
        udtName: "timestamp",
        nullable: false,
        defaultExpression: /(?:now\(\)|current_timestamp)/,
      },
    ] satisfies readonly ColumnContract[],
  },
  indexes: [
    {
      name: "preview_sessions_pkey",
      tableName: "preview_sessions",
      columns: ["id"],
      unique: true,
    },
    {
      name: "idx_preview_sessions_proposal_status",
      tableName: "preview_sessions",
      columns: ["proposal_id", "status"],
    },
    {
      name: "idx_preview_sessions_expires_at",
      tableName: "preview_sessions",
      columns: ["expires_at"],
    },
    {
      name: "uq_preview_sessions_runner_task_arn",
      tableName: "preview_sessions",
      columns: ["runner_task_arn"],
      unique: true,
    },
    {
      name: "uq_preview_sessions_build_receipt_id",
      tableName: "preview_sessions",
      columns: ["build_receipt_id"],
      unique: true,
    },
    {
      name: "uq_preview_sessions_build_job_id",
      tableName: "preview_sessions",
      columns: ["build_job_id"],
      unique: true,
    },
    {
      name: "preview_build_jobs_pkey",
      tableName: "preview_build_jobs",
      columns: ["job_id"],
      unique: true,
    },
    {
      name: "uq_preview_build_jobs_build_id",
      tableName: "preview_build_jobs",
      columns: ["build_id"],
      unique: true,
    },
    {
      name: "uq_preview_build_jobs_request",
      tableName: "preview_build_jobs",
      columns: ["project_id", "user_id", "client_request_id"],
      unique: true,
    },
    {
      name: "uq_preview_build_jobs_task_arn",
      tableName: "preview_build_jobs",
      columns: ["builder_task_arn"],
      unique: true,
    },
    {
      name: "uq_preview_build_jobs_output_key",
      tableName: "preview_build_jobs",
      columns: ["output_artifact_key"],
      unique: true,
    },
    {
      name: "uq_preview_build_jobs_receipt_id",
      tableName: "preview_build_jobs",
      columns: ["build_receipt_id"],
      unique: true,
    },
    {
      name: "idx_preview_build_jobs_project_status_created",
      tableName: "preview_build_jobs",
      columns: ["project_id", "status", "created_at"],
    },
    {
      name: "idx_preview_build_jobs_proposal_status",
      tableName: "preview_build_jobs",
      columns: ["proposal_id", "status"],
    },
    {
      name: "idx_preview_build_jobs_token_expiry",
      tableName: "preview_build_jobs",
      columns: ["token_expires_at"],
    },
    {
      name: "idx_preview_build_jobs_input_gc_due",
      tableName: "preview_build_jobs",
      columns: [
        "input_artifact_provider",
        "input_artifact_gc_state",
        "input_artifact_gc_marked_at",
      ],
    },
    {
      name: "idx_preview_build_jobs_output_gc_due",
      tableName: "preview_build_jobs",
      columns: [
        "output_artifact_provider",
        "output_artifact_gc_state",
        "output_artifact_gc_marked_at",
      ],
    },
    {
      name: "preview_access_tickets_pkey",
      tableName: "preview_access_tickets",
      columns: ["ticket_digest"],
      unique: true,
    },
    {
      name: "idx_preview_access_tickets_expires_at",
      tableName: "preview_access_tickets",
      columns: ["expires_at"],
    },
    {
      name: "preview_agent_nodes_pkey",
      tableName: "preview_agent_nodes",
      columns: ["node_id"],
      unique: true,
    },
    {
      name: "uq_preview_agent_nodes_live_store",
      tableName: "preview_agent_nodes",
      columns: ["store_id"],
      unique: true,
      predicatePattern:
        /"?status"? = any \(array\['pending'::preview_agent_node_status, 'active'::preview_agent_node_status\]\)/,
    },
    {
      name: "uq_preview_agent_nodes_pairing_code_hash",
      tableName: "preview_agent_nodes",
      columns: ["pairing_code_hash"],
      unique: true,
    },
    {
      name: "uq_preview_agent_nodes_public_key_fingerprint",
      tableName: "preview_agent_nodes",
      columns: ["public_key_fingerprint"],
      unique: true,
    },
    {
      name: "idx_preview_agent_nodes_project_status",
      tableName: "preview_agent_nodes",
      columns: ["project_id", "status"],
    },
    {
      name: "idx_preview_agent_nodes_pairing_expiry",
      tableName: "preview_agent_nodes",
      columns: ["status", "pairing_expires_at"],
    },
    {
      name: "idx_ai_chat_messages_created_at_id",
      tableName: "ai_chat_messages",
      columns: ["created_at", "id"],
    },
    {
      name: "idx_ai_executions_updated_at_id",
      tableName: "ai_executions",
      columns: ["updated_at", "id"],
    },
    {
      name: "openrouter_model_cooldowns_provider_model_pk",
      unique: true,
      tableName: "openrouter_model_cooldowns",
      columns: ["provider", "model"],
    },
    {
      name: "idx_openrouter_model_cooldowns_expiry",
      tableName: "openrouter_model_cooldowns",
      columns: ["cooling_until"],
    },
    {
      name: "openrouter_lane_cursors_pk",
      unique: true,
      tableName: "openrouter_lane_cursors",
      columns: ["cursor_key", "candidate_set_hash"],
    },
    {
      name: "idx_openrouter_lane_cursors_updated_at",
      tableName: "openrouter_lane_cursors",
      columns: ["updated_at"],
    },
    {
      name: "openrouter_credential_cooldowns_pk",
      unique: true,
      tableName: "openrouter_credential_cooldowns",
      columns: ["credential_fingerprint"],
    },
    {
      name: "idx_openrouter_credential_cooldowns_expiry",
      tableName: "openrouter_credential_cooldowns",
      columns: ["cooling_until"],
    },
    {
      name: "uq_project_plugin_bindings_project_plugin",
      unique: true,
      tableName: "project_plugin_bindings",
      columns: ["project_id", "plugin_id"],
    },
    {
      name: "idx_plugin_dispatch_batches_project_created",
      tableName: "plugin_dispatch_batches",
      columns: ["project_id", "created_at"],
    },
    {
      name: "uq_plugin_runs_dispatch_plugin",
      tableName: "plugin_runs",
      columns: ["dispatch_id", "plugin_id"],
      unique: true,
    },
    {
      name: "idx_plugin_runs_pending",
      tableName: "plugin_runs",
      columns: ["status", "next_attempt_at"],
    },
    {
      name: "idx_plugin_runs_expired_lease",
      tableName: "plugin_runs",
      columns: ["status", "lease_until"],
    },
    {
      name: "uq_project_bootstrap_jobs_owner_idempotency",
      unique: true,
      tableName: "project_bootstrap_jobs",
      columns: ["owner_id", "idempotency_key"],
    },
    {
      name: "idx_project_bootstrap_jobs_status_created",
      tableName: "project_bootstrap_jobs",
      columns: ["status", "created_at"],
    },
    {
      name: "idx_project_bootstrap_jobs_status_lease",
      tableName: "project_bootstrap_jobs",
      columns: ["status", "lease_until"],
    },
    {
      name: "idx_project_bootstrap_jobs_owner_created",
      tableName: "project_bootstrap_jobs",
      columns: ["owner_id", "created_at"],
    },
    {
      name: "idx_ai_general_chat_sessions_owner_updated",
      tableName: "ai_general_chat_sessions",
      columns: ["owner_id", "updated_at"],
    },
    {
      name: "idx_ai_general_chat_sessions_owner_created",
      tableName: "ai_general_chat_sessions",
      columns: ["owner_id", "created_at"],
    },
    {
      name: "uq_ai_general_chat_messages_session_turn_role",
      unique: true,
      tableName: "ai_general_chat_messages",
      columns: ["session_id", "turn_id", "role"],
    },
    {
      name: "idx_ai_general_chat_messages_session_created",
      tableName: "ai_general_chat_messages",
      columns: ["session_id", "created_at"],
    },
    {
      name: "idx_project_plugin_bindings_project_enabled",
      tableName: "project_plugin_bindings",
      columns: ["project_id", "enabled"],
    },
    {
      name: "idx_tasks_project_id",
      tableName: "tasks",
      columns: ["project_id"],
    },
    {
      name: "idx_tasks_project_id_created_at",
      tableName: "tasks",
      columns: ["project_id", "created_at"],
    },
    { name: "idx_tasks_status", tableName: "tasks", columns: ["status"] },
    { name: "idx_tasks_priority", tableName: "tasks", columns: ["priority"] },
    {
      name: "idx_tasks_correlation_id",
      tableName: "tasks",
      columns: ["correlation_id"],
    },
    {
      name: "idx_tasks_status_lease_until",
      tableName: "tasks",
      columns: ["status", "lease_until"],
    },
    {
      name: "idx_task_logs_task_id",
      tableName: "task_logs",
      columns: ["task_id"],
    },
    {
      name: "idx_task_logs_task_id_timestamp",
      tableName: "task_logs",
      columns: ["task_id", "timestamp"],
    },
    {
      name: "idx_task_logs_correlation_id",
      tableName: "task_logs",
      columns: ["correlation_id"],
    },
    {
      name: "idx_task_logs_task_execution_sequence",
      tableName: "task_logs",
      columns: ["task_id", "execution_id", "sequence"],
    },
    {
      name: "idx_ai_session_memories_project_rel",
      tableName: "ai_session_memories",
      columns: ["project_id", "relevance"],
    },
    {
      name: "idx_ai_session_memories_session_id",
      tableName: "ai_session_memories",
      columns: ["session_id"],
    },
    {
      name: "idx_ai_session_memories_project_scope",
      tableName: "ai_session_memories",
      columns: ["project_id", "scope"],
    },
    {
      name: "idx_ai_session_memories_expires_at",
      tableName: "ai_session_memories",
      columns: ["expires_at"],
    },
    {
      name: "uq_ai_session_memories_dedupe_key",
      unique: true,
      tableName: "ai_session_memories",
      columns: ["dedupe_key"],
    },
    {
      name: "uq_ai_session_memory_outbox_session_turn",
      unique: true,
      tableName: "ai_session_memory_outbox",
      columns: ["session_id", "turn_id"],
    },
    {
      name: "idx_ai_session_memory_outbox_next_attempt_at",
      tableName: "ai_session_memory_outbox",
      columns: ["next_attempt_at"],
    },
    {
      name: "uq_ai_execution_evidence_snapshots_attempt",
      unique: true,
      tableName: "ai_execution_evidence_snapshots",
      columns: ["execution_id", "attempt"],
    },
    {
      name: "idx_ai_execution_evidence_snapshots_operation",
      tableName: "ai_execution_evidence_snapshots",
      columns: ["project_id", "operation_id"],
    },
    {
      name: "idx_ai_execution_evidence_reads_snapshot",
      tableName: "ai_execution_evidence_reads",
      columns: ["snapshot_id"],
    },
    {
      name: "uq_ai_execution_acceptances_execution_attempt",
      unique: true,
      tableName: "ai_execution_acceptances",
      columns: ["execution_id", "attempt"],
    },
    {
      name: "uq_ai_execution_acceptances_finalization_key",
      unique: true,
      tableName: "ai_execution_acceptances",
      columns: ["finalization_key"],
    },
    {
      name: "idx_ai_execution_acceptances_project_created",
      tableName: "ai_execution_acceptances",
      columns: ["project_id", "created_at"],
    },
    {
      name: "idx_ai_execution_acceptances_effect_bundle",
      tableName: "ai_execution_acceptances",
      columns: ["effect_bundle_id"],
    },
    {
      name: "uq_ai_agent_episodes_execution_attempt",
      unique: true,
      tableName: "ai_agent_episodes",
      columns: ["execution_id", "attempt"],
    },
    {
      name: "uq_ai_agent_episodes_idempotency",
      unique: true,
      tableName: "ai_agent_episodes",
      columns: ["execution_id", "idempotency_key"],
    },
    {
      name: "idx_ai_agent_episodes_project_created",
      tableName: "ai_agent_episodes",
      columns: ["project_id", "created_at"],
    },
    {
      name: "idx_ai_agent_episodes_worker_lease",
      tableName: "ai_agent_episodes",
      columns: ["worker_id", "lease_until"],
    },
    {
      name: "uq_ai_agent_episode_events_sequence",
      unique: true,
      tableName: "ai_agent_episode_events",
      columns: ["episode_id", "sequence"],
    },
    {
      name: "uq_ai_agent_episode_events_idempotency",
      unique: true,
      tableName: "ai_agent_episode_events",
      columns: ["episode_id", "event_type", "payload_hash"],
    },
    {
      name: "idx_ai_agent_episode_events_execution",
      tableName: "ai_agent_episode_events",
      columns: ["execution_id", "attempt", "sequence"],
    },
    {
      name: "uq_ai_agent_observations_identity",
      unique: true,
      tableName: "ai_agent_observations",
      columns: [
        "project_id",
        "episode_id",
        "task_scope",
        "environment_revision_key",
        "environment_freshness",
        "provenance",
        "completeness",
        "freshness",
        "observation_role",
        "source_type",
        "source_id",
        "source_version",
        "subject",
        "predicate",
        "value_hash",
      ],
    },
    {
      name: "idx_ai_agent_observations_episode_sequence",
      tableName: "ai_agent_observations",
      columns: ["episode_id", "sequence"],
    },
    {
      name: "idx_ai_agent_observations_project_subject",
      tableName: "ai_agent_observations",
      columns: ["project_id", "subject", "predicate"],
    },
    {
      name: "uq_ai_agent_effects_execution_attempt_action",
      unique: true,
      tableName: "ai_agent_effects",
      columns: ["execution_id", "attempt", "action_id", "effect_contract_hash"],
    },
    {
      name: "idx_ai_agent_effects_episode",
      tableName: "ai_agent_effects",
      columns: ["episode_id", "created_at"],
    },
    {
      name: "idx_ai_agent_effects_project_status",
      tableName: "ai_agent_effects",
      columns: ["project_id", "status"],
    },
    {
      name: "uq_ai_agent_effect_bundles_execution_attempt",
      unique: true,
      tableName: "ai_agent_effect_bundles",
      columns: ["execution_id", "attempt"],
    },
    {
      name: "idx_ai_agent_effect_bundles_project_created",
      tableName: "ai_agent_effect_bundles",
      columns: ["project_id", "created_at"],
    },
    {
      name: "uq_ai_agent_shadow_campaign_event_identity",
      unique: true,
      tableName: "ai_agent_shadow_campaign_events",
      columns: [
        "campaign_id",
        "execution_id",
        "attempt",
        "idempotency_key_hash",
      ],
    },
    {
      name: "idx_ai_agent_shadow_campaign_events_campaign_time",
      tableName: "ai_agent_shadow_campaign_events",
      columns: ["campaign_id", "occurred_at"],
    },
    {
      name: "idx_ai_agent_shadow_campaign_events_project_time",
      tableName: "ai_agent_shadow_campaign_events",
      columns: ["project_id", "occurred_at"],
    },
    {
      name: "uq_ai_world_facts_project_key_version",
      unique: true,
      tableName: "ai_world_facts",
      columns: [
        "project_id",
        "task_scope",
        "environment_revision_key",
        "subject",
        "predicate",
        "version",
      ],
    },
    {
      name: "idx_ai_world_facts_project_key",
      tableName: "ai_world_facts",
      columns: [
        "project_id",
        "task_scope",
        "environment_revision_key",
        "subject",
        "predicate",
        "status",
      ],
    },
    {
      name: "uq_ai_world_transitions_action",
      unique: true,
      tableName: "ai_world_transitions",
      columns: [
        "project_id",
        "execution_id",
        "attempt",
        "episode_id",
        "action_id",
      ],
    },
    {
      name: "uq_ai_world_transitions_idempotency",
      unique: true,
      tableName: "ai_world_transitions",
      columns: ["project_id", "idempotency_key"],
    },
    {
      name: "idx_ai_world_transitions_recovery",
      tableName: "ai_world_transitions",
      columns: ["project_id", "status", "next_retry_at"],
    },
    {
      name: "uq_ai_strategy_candidates_project_key_version",
      unique: true,
      tableName: "ai_strategy_candidates",
      columns: ["project_id", "strategy_key", "version"],
    },
    {
      name: "idx_ai_strategy_candidates_project_status",
      tableName: "ai_strategy_candidates",
      columns: ["project_id", "evaluation_status"],
    },
    {
      name: "uq_ai_strategy_replay_cases_candidate_episode",
      unique: true,
      tableName: "ai_strategy_replay_cases",
      columns: ["candidate_id", "source_episode_id"],
    },
    {
      name: "idx_ai_strategy_replay_cases_project_candidate",
      tableName: "ai_strategy_replay_cases",
      columns: ["project_id", "candidate_id"],
    },
    {
      name: "uq_ai_strategy_replay_case_runs_case_attempt",
      unique: true,
      tableName: "ai_strategy_replay_case_runs",
      columns: ["case_registration_id", "attempt_number"],
    },
    {
      name: "uq_ai_strategy_replay_case_runs_operation",
      unique: true,
      tableName: "ai_strategy_replay_case_runs",
      columns: ["operation_id"],
    },
    {
      name: "idx_ai_strategy_replay_case_runs_project_candidate_status",
      tableName: "ai_strategy_replay_case_runs",
      columns: ["project_id", "candidate_id", "status"],
    },
    {
      name: "uq_ai_usage_events_attempt_id",
      unique: true,
      tableName: "ai_usage_events",
      columns: ["attempt_id"],
    },
    {
      name: "idx_ai_usage_events_project_occurred",
      tableName: "ai_usage_events",
      columns: ["project_id", "occurred_at"],
    },
    {
      name: "idx_ai_usage_events_user_occurred",
      tableName: "ai_usage_events",
      columns: ["user_id", "occurred_at"],
    },
    {
      name: "idx_ai_usage_events_provider_occurred",
      tableName: "ai_usage_events",
      columns: ["provider", "occurred_at"],
    },
    {
      name: "idx_ai_usage_events_correlation",
      tableName: "ai_usage_events",
      columns: ["correlation_id"],
    },
    {
      name: "uq_ai_mission_handoffs_mission_id",
      unique: true,
      tableName: "ai_mission_handoffs",
      columns: ["mission_id"],
    },
    {
      name: "uq_ai_mission_handoffs_user_idempotency",
      unique: true,
      tableName: "ai_mission_handoffs",
      columns: ["user_id", "idempotency_key"],
    },
    {
      name: "idx_ai_mission_handoffs_session_id",
      tableName: "ai_mission_handoffs",
      columns: ["session_id"],
    },
    {
      name: "idx_ai_mission_handoffs_dispatch",
      tableName: "ai_mission_handoffs",
      columns: ["dispatch_status", "created_at"],
    },
  ] satisfies readonly IndexContract[],
  foreignKeys: [
    {
      tableName: "preview_sessions",
      columnName: "build_job_id",
      foreignTableName: "preview_build_jobs",
      foreignColumnName: "job_id",
      deleteRule: "RESTRICT",
    },
    {
      tableName: "preview_build_jobs",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "preview_build_jobs",
      columnName: "proposal_id",
      foreignTableName: "ai_change_proposals",
      foreignColumnName: "id",
      deleteRule: "RESTRICT",
    },
    {
      tableName: "preview_sessions",
      columnName: "proposal_id",
      foreignTableName: "ai_change_proposals",
      foreignColumnName: "id",
      deleteRule: "RESTRICT",
    },
    {
      tableName: "preview_access_tickets",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "preview_access_tickets",
      columnName: "preview_session_id",
      foreignTableName: "preview_sessions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "preview_access_tickets",
      columnName: "proposal_id",
      foreignTableName: "ai_change_proposals",
      foreignColumnName: "id",
      deleteRule: "RESTRICT",
    },
    {
      tableName: "preview_agent_nodes",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "project_bootstrap_jobs",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_general_chat_messages",
      columnName: "session_id",
      foreignTableName: "ai_general_chat_sessions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "plugin_dispatch_batches",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "plugin_dispatch_batches",
      columnName: "scan_job_id",
      foreignTableName: "scan_jobs",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "plugin_runs",
      columnName: "dispatch_id",
      foreignTableName: "plugin_dispatch_batches",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "plugin_runs",
      columnName: "plugin_id",
      foreignTableName: "plugins",
      foreignColumnName: "id",
      deleteRule: "RESTRICT",
    },
    {
      tableName: "project_plugin_bindings",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_mission_handoffs",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_mission_handoffs",
      columnName: "mission_id",
      foreignTableName: "ai_missions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_mission_handoffs",
      columnName: "session_id",
      foreignTableName: "ai_chat_sessions",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_mission_handoffs",
      columnName: "message_id",
      foreignTableName: "ai_chat_messages",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_mission_handoffs",
      columnName: "assistant_message_id",
      foreignTableName: "ai_chat_messages",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "project_plugin_bindings",
      columnName: "plugin_id",
      foreignTableName: "plugins",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "tasks",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "tasks",
      columnName: "rule_id",
      foreignTableName: "rules",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "tasks",
      columnName: "workflow_id",
      foreignTableName: "workflows",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "task_logs",
      columnName: "task_id",
      foreignTableName: "tasks",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_session_memories",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_session_memories",
      columnName: "session_id",
      foreignTableName: "ai_chat_sessions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_session_memory_outbox",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_session_memory_outbox",
      columnName: "session_id",
      foreignTableName: "ai_chat_sessions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_execution_evidence_snapshots",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_execution_evidence_snapshots",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_execution_evidence_reads",
      columnName: "snapshot_id",
      foreignTableName: "ai_execution_evidence_snapshots",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_execution_acceptances",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_execution_acceptances",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_execution_acceptances",
      columnName: "evidence_snapshot_id",
      foreignTableName: "ai_execution_evidence_snapshots",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_execution_acceptances",
      columnName: "message_id",
      foreignTableName: "ai_chat_messages",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_execution_acceptances",
      columnName: "effect_bundle_id",
      foreignTableName: "ai_agent_effect_bundles",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_agent_episodes",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_episodes",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_episodes",
      columnName: "mission_id",
      foreignTableName: "ai_missions",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_agent_episodes",
      columnName: "goal_id",
      foreignTableName: "ai_goals",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_agent_episodes",
      columnName: "parent_episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_agent_episode_events",
      columnName: "episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_episode_events",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_episode_events",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_observations",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_observations",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_observations",
      columnName: "episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_effects",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_effects",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_effects",
      columnName: "episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_effect_bundles",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_effect_bundles",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_agent_effect_bundles",
      columnName: "episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_world_facts",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_world_transitions",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_world_transitions",
      columnName: "execution_id",
      foreignTableName: "ai_executions",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_world_transitions",
      columnName: "episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_world_transitions",
      columnName: "effect_bundle_id",
      foreignTableName: "ai_agent_effect_bundles",
      foreignColumnName: "id",
      deleteRule: "SET NULL",
    },
    {
      tableName: "ai_strategy_candidates",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_strategy_replay_cases",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_strategy_replay_cases",
      columnName: "candidate_id",
      foreignTableName: "ai_strategy_candidates",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_strategy_replay_cases",
      columnName: "source_episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_strategy_replay_case_runs",
      columnName: "project_id",
      foreignTableName: "projects",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_strategy_replay_case_runs",
      columnName: "case_registration_id",
      foreignTableName: "ai_strategy_replay_cases",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_strategy_replay_case_runs",
      columnName: "candidate_id",
      foreignTableName: "ai_strategy_candidates",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
    {
      tableName: "ai_strategy_replay_case_runs",
      columnName: "source_episode_id",
      foreignTableName: "ai_agent_episodes",
      foreignColumnName: "id",
      deleteRule: "CASCADE",
    },
  ] satisfies readonly ForeignKeyContract[],
  enums: {
    project_bootstrap_status: ["queued", "running", "completed", "failed"],
    ai_general_chat_message_role: ["user", "assistant"],
    ai_general_chat_message_status: ["pending", "completed", "failed"],
    ai_mission_handoff_dispatch_status: ["pending", "dispatched"],
    workspace_runtime_status: ["stopped", "starting", "running", "failed"],
    preview_session_status: [
      "starting",
      "ready",
      "stopping",
      "stopped",
      "failed",
      "expired",
    ],
    preview_build_job_status: [
      "queued",
      "launching",
      "running",
      "builder_succeeded",
      "verified",
      "failed",
      "expired",
      "cancelled",
    ],
    preview_artifact_gc_state: [
      "active",
      "eligible_for_gc",
      "deleting",
      "deleted",
    ],
    preview_artifact_provider: ["local", "s3"],
    preview_agent_node_status: ["pending", "active", "revoked"],
    task_status: [
      "pending",
      "queued",
      "running",
      "verifying",
      "completed",
      "failed",
      "cancelled",
    ],
    task_priority: ["p0", "p1", "p2", "p3"],
    log_level: ["debug", "info", "warn", "error"],
    ai_memory_type: [
      "file_summary",
      "entity_fact",
      "session_summary",
      "key_finding",
    ],
    ai_semantic_memory_kind: [
      "decision",
      "constraint",
      "unresolved_question",
      "key_finding",
    ],
    ai_semantic_memory_provenance: [
      "explicit_user_decision",
      "explicit_user_statement",
      "accepted_plan",
      "validated_finding",
    ],
    ai_semantic_memory_confirmation: [
      "unconfirmed",
      "user_confirmed",
      "server_validated",
    ],
    ai_semantic_memory_freshness: ["current_at_write", "stale", "unknown"],
    ai_agent_episode_state: [
      "created",
      "running",
      "paused",
      "effect_pending",
      "verifying",
      "waiting_approval",
      "needs_replan",
      "completed",
      "blocked",
      "failed",
      "cancelling",
      "cancelled",
    ],
    ai_agent_episode_verdict: [
      "achieved",
      "incomplete",
      "blocked",
      "replan_required",
      "world_changed",
      "needs_approval",
      "unsafe",
      "failed",
      "cancelled",
    ],
    ai_agent_episode_event_type: [
      "EPISODE_CREATED",
      "TOOL_INVOCATION_RECORDED",
      "OBSERVATION_REQUESTED",
      "OBSERVATION_RECORDED",
      "PLAN_SELECTED",
      "ACTION_REQUESTED",
      "ACTION_COMMITTED",
      "EFFECT_PENDING",
      "EFFECT_CLASSIFIED",
      "CLAIM_UPDATED",
      "REPLAN_REQUESTED",
      "ACCEPTANCE_LINKED",
      "EPISODE_PAUSED",
      "EPISODE_RESUMED",
      "EPISODE_CANCELLED",
      "EPISODE_TERMINAL",
    ],
    ai_agent_episode_actor_type: ["server", "worker", "user", "system"],
    ai_agent_observation_completeness: ["complete", "partial", "failed"],
    ai_agent_observation_freshness: ["fresh", "stale", "unknown"],
    ai_agent_effect_status: [
      "pending",
      "observed",
      "partial",
      "not_observed",
      "contradicted",
      "unknown",
    ],
    ai_agent_shadow_campaign_outcome: ["success", "failure"],
    ai_world_fact_status: [
      "believed",
      "confirmed",
      "contradicted",
      "superseded",
      "retracted",
    ],
    ai_world_transition_status: [
      "pending",
      "materialized",
      "retrying",
      "terminal_failed",
    ],
    ai_strategy_evaluation_status: [
      "discovered",
      "pending_replay",
      "replay_passed",
      "replay_failed",
      "canary",
      "promoted",
      "revoked",
      "superseded",
    ],
  },
} as const;

type TableRow = { table_name: string; table_type?: string };
type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
};
type IndexRow = {
  tablename: string;
  indexname: string;
  access_method: string;
  is_unique: boolean;
  is_valid: boolean;
  predicate: string | null;
  columns: string[];
};
type ForeignKeyRow = {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
  delete_rule: string;
};

const REQUIRED_ENUMS = Object.keys(APPLICATION_SCHEMA_CONTRACT.enums);
const REQUIRED_TABLES = [
  ...new Set([
    ...Object.keys(APPLICATION_SCHEMA_CONTRACT.tables),
    ...APPLICATION_SCHEMA_CONTRACT.indexes.map((index) => index.tableName),
  ]),
];
const DELIVERY_COMMAND = "pnpm --filter @workspace/db run schema:apply";
const REQUIRED_TABLE_SQL = REQUIRED_TABLES.map((name) => `'${name}'`).join(
  ", ",
);

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function issue(
  kind: ApplicationSchemaIssueKind,
  tableName: string,
  objectName: string,
  expected: string,
  actual?: string,
): ApplicationSchemaIssue {
  return {
    kind,
    tableName,
    objectName,
    expected,
    ...(actual ? { actual } : {}),
  };
}

export function formatApplicationSchemaIssues(
  issues: readonly ApplicationSchemaIssue[],
): string {
  return issues
    .map((item) => {
      const actual = item.actual ? ` (actual: ${item.actual})` : "";
      return `${item.kind} ${item.tableName}.${item.objectName}: expected ${item.expected}${actual}`;
    })
    .join("; ");
}

export class ApplicationSchemaError extends Error {
  readonly issues: readonly ApplicationSchemaIssue[];

  constructor(issues: readonly ApplicationSchemaIssue[]) {
    super(
      `Application schema contract is not satisfied: ${formatApplicationSchemaIssues(issues)}. ` +
        `Apply the schema with \`${DELIVERY_COMMAND}\`, then restart the API.`,
    );
    this.name = "ApplicationSchemaError";
    this.issues = issues;
  }
}

export interface ApplicationSchemaSnapshot {
  tables: readonly TableRow[];
  columns: readonly ColumnRow[];
  enums: readonly EnumRow[];
  indexes: readonly IndexRow[];
  primaryKeys: readonly { table_name: string; column_name: string }[];
  foreignKeys: readonly ForeignKeyRow[];
}

export function findApplicationSchemaIssues(
  snapshot: ApplicationSchemaSnapshot,
): ApplicationSchemaIssue[] {
  const issues: ApplicationSchemaIssue[] = [];
  const tables = new Set(snapshot.tables.map((row) => row.table_name));
  const columns = new Map(
    snapshot.columns.map((row) => [
      `${row.table_name}.${row.column_name}`,
      row,
    ]),
  );

  for (const tableName of REQUIRED_TABLES) {
    if (!tables.has(tableName)) {
      issues.push(issue("missing_table", "public", tableName, "table"));
    }
  }

  for (const [tableName, requiredColumns] of Object.entries(
    APPLICATION_SCHEMA_CONTRACT.tables,
  )) {
    if (!tables.has(tableName)) continue;
    for (const expected of requiredColumns) {
      const key = `${tableName}.${expected.name}`;
      const actual = columns.get(key);
      if (!actual) {
        issues.push(
          issue(
            "missing_column",
            tableName,
            expected.name,
            `${expected.dataType}, ${expected.nullable ? "nullable" : "NOT NULL"}`,
          ),
        );
        continue;
      }
      const expectedNullable = expected.nullable ? "YES" : "NO";
      const defaultMatches = expected.defaultExpression
        ? actual.column_default !== null &&
          expected.defaultExpression.test(normalized(actual.column_default))
        : actual.column_default === null;
      if (
        normalized(actual.data_type) !== normalized(expected.dataType) ||
        normalized(actual.udt_name) !== normalized(expected.udtName) ||
        actual.is_nullable !== expectedNullable ||
        !defaultMatches
      ) {
        const expectedDefault = expected.defaultExpression
          ? `, default matching ${expected.defaultExpression}`
          : "";
        issues.push(
          issue(
            "incompatible_column",
            tableName,
            expected.name,
            `${expected.dataType}/${expected.udtName}, ${expectedNullable}${expectedDefault}`,
            `${actual.data_type}/${actual.udt_name}, ${actual.is_nullable}, default=${actual.column_default ?? "NULL"}`,
          ),
        );
      }
    }
  }

  const enums = new Map(
    snapshot.enums.map((row) => [row.enum_name, row.enum_labels]),
  );
  for (const enumName of REQUIRED_ENUMS) {
    const expectedLabels =
      APPLICATION_SCHEMA_CONTRACT.enums[
        enumName as keyof typeof APPLICATION_SCHEMA_CONTRACT.enums
      ];
    const actualLabels = enums.get(enumName);
    if (
      !actualLabels ||
      actualLabels.length !== expectedLabels.length ||
      actualLabels.some((label, index) => label !== expectedLabels[index])
    ) {
      issues.push(
        issue(
          "incompatible_enum",
          "public",
          enumName,
          `[${expectedLabels.join(", ")}]`,
          actualLabels ? `[${actualLabels.join(", ")}]` : "type not found",
        ),
      );
    }
  }

  for (const tableName of REQUIRED_TABLES) {
    const expectedColumns =
      tableName === "startup_maintenance_state"
        ? ["maintenance_key"]
        : tableName === "openrouter_model_cooldowns"
          ? ["provider", "model"]
          : tableName === "openrouter_catalog_snapshots"
            ? ["catalog_key"]
            : tableName === "openrouter_lane_cursors"
              ? ["cursor_key", "candidate_set_hash"]
              : tableName === "openrouter_credential_cooldowns"
                ? ["credential_fingerprint"]
                : tableName === "ai_general_chat_rate_limits"
                  ? ["owner_id", "window_bucket"]
                  : tableName === "preview_build_jobs"
                    ? ["job_id"]
                    : tableName === "preview_access_tickets"
                      ? ["ticket_digest"]
                      : tableName === "preview_agent_nodes"
                        ? ["node_id"]
                        : ["id"];
    const actualColumns = snapshot.primaryKeys
      .filter((row) => row.table_name === tableName)
      .map((row) => row.column_name);
    if (
      snapshot.tables.some((row) => row.table_name === tableName) &&
      (actualColumns.length !== expectedColumns.length ||
        expectedColumns.some((column) => !actualColumns.includes(column)))
    ) {
      issues.push(
        issue(
          "missing_primary_key",
          tableName,
          expectedColumns.join(","),
          `PRIMARY KEY (${expectedColumns.map((column) => `${tableName}.${column}`).join(", ")})`,
        ),
      );
    }
  }

  const indexes = new Map(snapshot.indexes.map((row) => [row.indexname, row]));
  for (const expected of APPLICATION_SCHEMA_CONTRACT.indexes as readonly IndexContract[]) {
    const actual = indexes.get(expected.name);
    if (!actual) {
      issues.push(
        issue(
          "missing_index",
          expected.tableName,
          expected.name,
          `index on (${expected.columns.join(", ")})`,
        ),
      );
      continue;
    }
    const expectedAccessMethod = expected.accessMethod ?? "btree";
    const expectedPredicate = normalized(expected.predicate ?? "");
    const actualPredicate = normalized(actual.predicate ?? "");
    const predicateMatches = expected.predicatePattern
      ? expected.predicatePattern.test(actualPredicate)
      : actualPredicate === expectedPredicate;
    if (
      actual.tablename !== expected.tableName ||
      actual.access_method !== expectedAccessMethod ||
      !actual.is_valid ||
      actual.is_unique !== Boolean(expected.unique) ||
      !predicateMatches ||
      actual.columns.length !== expected.columns.length ||
      actual.columns.some((column, index) => column !== expected.columns[index])
    ) {
      issues.push(
        issue(
          "incompatible_index",
          expected.tableName,
          expected.name,
          `${expected.unique ? "unique " : ""}${expectedAccessMethod} index on (${expected.columns.join(", ")})${expectedPredicate ? ` WHERE ${expectedPredicate}` : expected.predicatePattern ? ` WHERE ${expected.predicatePattern}` : ""}`,
          `${actual.tablename} ${actual.is_unique ? "unique " : ""}${actual.access_method} (${actual.columns.join(", ")})${actualPredicate ? ` WHERE ${actual.predicate}` : ""}`,
        ),
      );
    }
  }

  const foreignKeys = new Set(
    snapshot.foreignKeys.map(
      (row) =>
        `${row.table_name}.${row.column_name}->${row.foreign_table_name}.${row.foreign_column_name}:${row.delete_rule.toUpperCase()}`,
    ),
  );
  for (const expected of APPLICATION_SCHEMA_CONTRACT.foreignKeys) {
    const key = `${expected.tableName}.${expected.columnName}->${expected.foreignTableName}.${expected.foreignColumnName}:${expected.deleteRule}`;
    if (!foreignKeys.has(key)) {
      issues.push(
        issue(
          "missing_foreign_key",
          expected.tableName,
          expected.columnName,
          `references ${expected.foreignTableName}.${expected.foreignColumnName} ON DELETE ${expected.deleteRule}`,
        ),
      );
    }
  }
  return issues;
}

export async function readApplicationSchemaSnapshot(
  client: SchemaQueryClient,
): Promise<ApplicationSchemaSnapshot> {
  // This function also receives a checked-out pg Client during startup.
  // Keep catalog reads sequential; pg clients do not support concurrent
  // queries on one connection.
  const tables = await client.query<TableRow>(`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${REQUIRED_TABLE_SQL})
  `);
  const columns = await client.query<ColumnRow>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (${REQUIRED_TABLE_SQL})
  `);
  const enums = await client.query<EnumRow>(
    `
      SELECT t.typname AS enum_name,
             array_agg(e.enumlabel::text ORDER BY e.enumsortorder)::text[] AS enum_labels
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = ANY($1::text[])
      GROUP BY t.typname
    `,
    [REQUIRED_ENUMS],
  );
  const indexes = await client.query<IndexRow>(`
    SELECT table_relation.relname AS tablename,
           index_relation.relname AS indexname,
           access_method.amname AS access_method,
           index_meta.indisunique AS is_unique,
           index_meta.indisvalid AS is_valid,
           pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate,
           ARRAY(
             SELECT COALESCE(
                      key_attribute.attname::text,
                      pg_get_indexdef(index_meta.indexrelid, key_position.position::integer, true)
                    )
             FROM generate_series(1, index_meta.indnkeyatts) AS key_position(position)
             LEFT JOIN pg_attribute key_attribute
               ON key_attribute.attrelid = index_meta.indrelid
              AND key_attribute.attnum = index_meta.indkey[key_position.position - 1]
             ORDER BY key_position.position
           ) AS columns
    FROM pg_index index_meta
    JOIN pg_class table_relation ON table_relation.oid = index_meta.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
    JOIN pg_class index_relation ON index_relation.oid = index_meta.indexrelid
    JOIN pg_am access_method ON access_method.oid = index_relation.relam
    WHERE table_namespace.nspname = 'public'
      AND table_relation.relname IN (${REQUIRED_TABLE_SQL})
  `);
  const primaryKeys = await client.query<{
    table_name: string;
    column_name: string;
  }>(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
     AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN (${REQUIRED_TABLE_SQL})
  `);
  const foreignKeys = await client.query<ForeignKeyRow>(`
    SELECT tc.table_name, kcu.column_name,
           ccu.table_name AS foreign_table_name,
           ccu.column_name AS foreign_column_name,
           rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
     AND tc.table_name = kcu.table_name
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN (${REQUIRED_TABLE_SQL})
  `);

  return {
    tables: tables.rows,
    columns: columns.rows,
    enums: enums.rows,
    indexes: indexes.rows,
    primaryKeys: primaryKeys.rows,
    foreignKeys: foreignKeys.rows,
  };
}

export async function assertApplicationSchemaWithClient(
  client: SchemaQueryClient,
): Promise<void> {
  const issues = findApplicationSchemaIssues(
    await readApplicationSchemaSnapshot(client),
  );
  if (issues.length > 0) throw new ApplicationSchemaError(issues);
}

export async function assertApplicationSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await assertApplicationSchemaWithClient(client);
  } finally {
    client.release();
  }
}

export const applicationSchemaDeliveryCommand = DELIVERY_COMMAND;
