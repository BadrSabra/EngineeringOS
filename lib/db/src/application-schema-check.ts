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

type IndexContract = {
  name: string;
  tableName: string;
  columns: readonly string[];
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
      { name: "confidence", dataType: "real", udtName: "float4", nullable: true },
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
  },
  indexes: [
    { name: "idx_tasks_project_id", tableName: "tasks", columns: ["project_id"] },
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
      tableName: "ai_session_memories",
      columns: ["dedupe_key"],
    },
    {
      name: "uq_ai_session_memory_outbox_session_turn",
      tableName: "ai_session_memory_outbox",
      columns: ["session_id", "turn_id"],
    },
    {
      name: "idx_ai_session_memory_outbox_next_attempt_at",
      tableName: "ai_session_memory_outbox",
      columns: ["next_attempt_at"],
    },
  ] satisfies readonly IndexContract[],
  foreignKeys: [
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
  ] satisfies readonly ForeignKeyContract[],
  enums: {
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
type IndexRow = { tablename: string; indexname: string; indexdef: string };
type ForeignKeyRow = {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
  delete_rule: string;
};

const REQUIRED_TABLES = Object.keys(APPLICATION_SCHEMA_CONTRACT.tables);
const REQUIRED_ENUMS = Object.keys(APPLICATION_SCHEMA_CONTRACT.enums);
const DELIVERY_COMMAND = "pnpm --filter @workspace/db run schema:apply";
const REQUIRED_TABLE_SQL = REQUIRED_TABLES.map((name) => `'${name}'`).join(", ");

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
    if (
      snapshot.tables.some((row) => row.table_name === tableName) &&
      !snapshot.primaryKeys.some(
        (row) => row.table_name === tableName && row.column_name === "id",
      )
    ) {
      issues.push(
        issue(
          "missing_primary_key",
          tableName,
          "id",
          `PRIMARY KEY (${tableName}.id)`,
        ),
      );
    }
  }

  const indexes = new Map(snapshot.indexes.map((row) => [row.indexname, row]));
  for (const expected of APPLICATION_SCHEMA_CONTRACT.indexes) {
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
    // pg_indexes quotes reserved identifiers such as "timestamp". Compare
    // normalized identifier text rather than requiring one exact formatter.
    const definition = normalized(actual.indexdef).replace(/"/g, "");
    const expectedColumns = `(${expected.columns.join(", ")})`;
    if (!definition.includes(normalized(expectedColumns))) {
      issues.push(
        issue(
          "incompatible_index",
          actual.tablename,
          expected.name,
          `index on ${expectedColumns}`,
          actual.indexdef,
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
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN (${REQUIRED_TABLE_SQL})
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
