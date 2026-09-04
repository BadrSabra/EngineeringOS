import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const LOCK_DIRECTORY = "/tmp/engineeringos-legacy-memory-schema-canary.lock";
const COMMAND = "pnpm";
const COMMAND_ARGS = ["--filter", "@workspace/db", "run", "schema:apply"];
const DATABASE_CONNECT_TIMEOUT_MS = 15_000;
const SCHEMA_DELIVERY_TIMEOUT_MS = 120_000;
const LEGACY_PROJECT_ID = "legacy-memory-canary-project";
const LEGACY_SESSION_ID = "legacy-memory-canary-session";
const OUTBOX_ID = "legacy-memory-canary-outbox";
const MODERN_MEMORY_COLUMNS = [
  "dedupe_key",
  "semantic_kind",
  "scope",
  "turn_id",
  "provenance",
  "source_reference",
  "source_revision",
  "confidence",
  "confirmation_status",
  "freshness_status",
  "last_decay_at",
] as const;

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

type LegacyMemoryProjection = {
  id: string;
  projectId: string;
  sessionId: string;
  memoryType: string;
  content: string;
  sourcePath: string | null;
  relevance: number;
  createdAt: string;
  expiresAt: string | null;
};

type MemoryProjection = LegacyMemoryProjection & {
  dedupeKey: string | null;
  semanticKind: string | null;
  scope: string | null;
  turnId: string | null;
  provenance: string | null;
  sourceReference: string | null;
  sourceRevision: string | null;
  confidence: number | null;
  confirmationStatus: string | null;
  freshnessStatus: string | null;
  lastDecayAt: string | null;
};

type OutboxProjection = {
  id: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  toolSources: string[];
  responseText: string;
  semanticRecords: unknown[];
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
};

type DatabaseParts = {
  database: string;
};

type CommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

class CanaryFailure extends Error {
  constructor(
    readonly phase: string,
    readonly issueKind: string,
  ) {
    super(issueKind);
    this.name = "CanaryFailure";
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new CanaryFailure("configuration", `missing_${name.toLowerCase()}`);
  }
  return value;
}

function parseDatabaseUrl(value: string, name: string): DatabaseParts {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CanaryFailure("configuration", `invalid_${name.toLowerCase()}`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new CanaryFailure("configuration", `invalid_${name.toLowerCase()}`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!database || database.includes("\0")) {
    throw new CanaryFailure("configuration", `invalid_${name.toLowerCase()}`);
  }
  return {
    database,
  };
}

function databaseIdentity(value: string): string {
  const parsed = new URL(value);
  return [
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    decodeURIComponent(parsed.username),
    decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
  ].join("|");
}

function buildDisposableDatabaseUrl(
  maintenanceUrl: string,
  databaseName: string,
): string {
  const parsed = new URL(maintenanceUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new CanaryFailure("configuration", "unsafe_database_name");
  }
  return `"${value}"`;
}

function createDatabaseName(): string {
  return `eos_legacy_mem_${Date.now().toString(36)}_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 16)}`;
}

function timestampValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new CanaryFailure("verification", "invalid_timestamp");
  }
  return date.toISOString();
}

function memoryProjection(row: Record<string, unknown>): MemoryProjection {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sessionId: String(row.session_id),
    memoryType: String(row.memory_type),
    content: String(row.content),
    sourcePath: row.source_path === null ? null : String(row.source_path),
    relevance: Number(row.relevance),
    createdAt: timestampValue(row.created_at),
    expiresAt:
      row.expires_at === null ? null : timestampValue(row.expires_at),
    dedupeKey: row.dedupe_key === null ? null : String(row.dedupe_key),
    semanticKind:
      row.semantic_kind === null ? null : String(row.semantic_kind),
    scope: row.scope === null ? null : String(row.scope),
    turnId: row.turn_id === null ? null : String(row.turn_id),
    provenance: row.provenance === null ? null : String(row.provenance),
    sourceReference:
      row.source_reference === null ? null : String(row.source_reference),
    sourceRevision:
      row.source_revision === null ? null : String(row.source_revision),
    confidence: row.confidence === null ? null : Number(row.confidence),
    confirmationStatus:
      row.confirmation_status === null
        ? null
        : String(row.confirmation_status),
    freshnessStatus:
      row.freshness_status === null ? null : String(row.freshness_status),
    lastDecayAt:
      row.last_decay_at === null ? null : timestampValue(row.last_decay_at),
  };
}

function legacyMemoryProjection(
  row: Record<string, unknown>,
): LegacyMemoryProjection {
  const full = memoryProjection({
    ...row,
    dedupe_key: null,
    semantic_kind: null,
    scope: null,
    turn_id: null,
    provenance: null,
    source_reference: null,
    source_revision: null,
    confidence: null,
    confirmation_status: null,
    freshness_status: null,
    last_decay_at: null,
  });
  const {
    dedupeKey: _dedupeKey,
    semanticKind: _semanticKind,
    scope: _scope,
    turnId: _turnId,
    provenance: _provenance,
    sourceReference: _sourceReference,
    sourceRevision: _sourceRevision,
    confidence: _confidence,
    confirmationStatus: _confirmationStatus,
    freshnessStatus: _freshnessStatus,
    lastDecayAt: _lastDecayAt,
    ...legacy
  } = full;
  return legacy;
}

function outboxProjection(row: Record<string, unknown>): OutboxProjection {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sessionId: String(row.session_id),
    turnId: String(row.turn_id),
    toolSources: Array.isArray(row.tool_sources)
      ? row.tool_sources.map(String)
      : [],
    responseText: String(row.response_text),
    semanticRecords: Array.isArray(row.semantic_records)
      ? row.semantic_records
      : [],
    attempts: Number(row.attempts),
    nextAttemptAt: timestampValue(row.next_attempt_at),
    createdAt: timestampValue(row.created_at),
  };
}

function assertEqual<T>(actual: T, expected: T, issueKind: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new CanaryFailure("verification", issueKind);
  }
}

async function acquireLock(): Promise<() => Promise<void>> {
  try {
    await mkdir(LOCK_DIRECTORY);
    const owner = await open(path.join(LOCK_DIRECTORY, "owner"), "w");
    await owner.writeFile(String(process.pid));
    await owner.close();
  } catch {
    throw new CanaryFailure("setup", "schema_canary_already_running");
  }
  return async () => {
    await rm(LOCK_DIRECTORY, { recursive: true, force: true });
  };
}

async function runSchemaDelivery(
  databaseUrl: string,
  phase: string,
): Promise<void> {
  const result = await new Promise<CommandResult>((resolve) => {
    const child = spawn(COMMAND, COMMAND_ARGS, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), SCHEMA_DELIVERY_TIMEOUT_MS);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ exitCode: null, signal: null, stdout, stderr });
    });
    child.on("close", (exitCode, signal) =>
      (() => {
        clearTimeout(timeout);
        resolve({ exitCode, signal, stdout, stderr });
      })(),
    );
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    // Keep provider/database output out of CI logs. The phase and process
    // outcome are enough to distinguish delivery from contract failures.
    throw new CanaryFailure(
      phase,
      result.signal ? "schema_delivery_signaled" : "schema_delivery_failed",
    );
  }
}

async function connectOrFail(
  client: Client,
  phase: string,
  issueKind: string,
): Promise<void> {
  try {
    await client.connect();
  } catch {
    throw new CanaryFailure(phase, issueKind);
  }
}

async function createLegacyFixture(
  client: Client,
): Promise<LegacyMemoryProjection[]> {
  await client.query(`
    CREATE TYPE ai_memory_type AS ENUM (
      'file_summary',
      'entity_fact',
      'session_summary',
      'key_finding'
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      root_path TEXT NOT NULL,
      language TEXT NOT NULL,
      framework TEXT,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL,
      CONSTRAINT projects_root_path_unique UNIQUE (root_path)
    );

    CREATE TABLE ai_chat_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      linked_task_id TEXT,
      active_task_state TEXT,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    );

    CREATE TABLE ai_session_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
      memory_type ai_memory_type NOT NULL,
      content TEXT NOT NULL,
      source_path TEXT,
      relevance REAL NOT NULL DEFAULT 1.0,
      created_at TIMESTAMP NOT NULL,
      expires_at TIMESTAMP
    );

    CREATE INDEX idx_ai_session_memories_project_rel
      ON ai_session_memories (project_id, relevance);
    CREATE INDEX idx_ai_session_memories_session_id
      ON ai_session_memories (session_id);
    CREATE INDEX idx_ai_session_memories_expires_at
      ON ai_session_memories (expires_at);
  `);

  const projectCreatedAt = "2026-01-01T10:00:00.000Z";
  const sessionCreatedAt = "2026-01-01T10:01:00.000Z";
  await client.query(
    `
      INSERT INTO projects
        (id, owner_id, name, description, root_path, language, framework, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    `,
    [
      LEGACY_PROJECT_ID,
      "legacy-memory-canary-owner",
      "Legacy memory canary project",
      "Disposable legacy fixture",
      "/tmp/legacy-memory-canary",
      "typescript",
      "node",
      projectCreatedAt,
    ],
  );
  await client.query(
    `
      INSERT INTO ai_chat_sessions
        (id, project_id, title, linked_task_id, active_task_state, created_at, updated_at)
      VALUES ($1, $2, $3, NULL, NULL, $4, $4)
    `,
    [
      LEGACY_SESSION_ID,
      LEGACY_PROJECT_ID,
      "Legacy memory canary session",
      sessionCreatedAt,
    ],
  );

  const rows = [
    {
      id: "legacy-memory-file",
      memoryType: "file_summary",
      content: "Navigation summary for the routing boundary.",
      sourcePath: "src/navigation.ts",
      relevance: 0.87,
      createdAt: "2026-01-02T11:00:00.000Z",
      expiresAt: "2026-02-01T11:00:00.000Z",
    },
    {
      id: "legacy-memory-finding",
      memoryType: "key_finding",
      content: "Key finding: the graph reader is project scoped.",
      sourcePath: "src/graph-reader.ts",
      relevance: 0.63,
      createdAt: "2026-01-03T12:00:00.000Z",
      expiresAt: "2026-02-02T12:00:00.000Z",
    },
  ];
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO ai_session_memories
          (id, project_id, session_id, memory_type, content, source_path, relevance, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        row.id,
        LEGACY_PROJECT_ID,
        LEGACY_SESSION_ID,
        row.memoryType,
        row.content,
        row.sourcePath,
        row.relevance,
        row.createdAt,
        row.expiresAt,
      ],
    );
  }
  return rows.map((row) =>
    legacyMemoryProjection({
      ...row,
      project_id: LEGACY_PROJECT_ID,
      session_id: LEGACY_SESSION_ID,
      source_path: row.sourcePath,
      memory_type: row.memoryType,
      created_at: row.createdAt,
      expires_at: row.expiresAt,
    }),
  );
}

async function assertLegacyShapeBeforeDelivery(
  client: Client,
): Promise<void> {
  const tableResult = await client.query<{ exists: boolean }>(`
    SELECT to_regclass('public.ai_session_memory_outbox') IS NOT NULL AS exists
  `);
  if (tableResult.rows[0]?.exists) {
    throw new CanaryFailure("fixture", "outbox_present_before_delivery");
  }
  const metadataResult = await client.query<{ type_name: string }>(`
    SELECT typname AS type_name
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname IN (
        'ai_semantic_memory_kind',
        'ai_semantic_memory_provenance',
        'ai_semantic_memory_confirmation',
        'ai_semantic_memory_freshness'
      )
  `);
  if (metadataResult.rows.length !== 0) {
    throw new CanaryFailure("fixture", "modern_memory_enum_present");
  }
  const columns = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_session_memories'
  `);
  const actual = columns.rows.map((row) => row.column_name).sort();
  assertEqual(
    actual,
    [
      "content",
      "created_at",
      "expires_at",
      "id",
      "memory_type",
      "project_id",
      "relevance",
      "session_id",
      "source_path",
    ],
    "legacy_memory_shape_changed",
  );
}

async function readMemoryRows(
  client: Queryable,
): Promise<MemoryProjection[]> {
  const result = await client.query(`
    SELECT id, project_id, session_id, memory_type, content, source_path,
           dedupe_key, semantic_kind, scope, turn_id, provenance,
           source_reference, source_revision, confidence, confirmation_status,
           freshness_status, relevance, created_at, expires_at, last_decay_at
    FROM ai_session_memories
    ORDER BY id
  `);
  return result.rows.map(memoryProjection);
}

async function readOutboxRows(
  client: Queryable,
): Promise<OutboxProjection[]> {
  const result = await client.query(`
    SELECT id, project_id, session_id, turn_id, tool_sources, response_text,
           semantic_records, attempts, next_attempt_at, created_at
    FROM ai_session_memory_outbox
    ORDER BY id
  `);
  return result.rows.map(outboxProjection);
}

async function assertReadOnlyContract(
  client: Queryable,
  assertContract: (client: Queryable) => Promise<void>,
): Promise<void> {
  const queries: string[] = [];
  const readOnlyClient: Queryable = {
    query: async <T extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) => {
      queries.push(text);
      if (!/^\s*SELECT\b/i.test(text)) {
        throw new CanaryFailure("startup_preflight", "preflight_issued_ddl");
      }
      return client.query<T>(text, values);
    },
  };
  await assertContract(readOnlyClient);
  if (queries.length === 0 || queries.some((query) => !/^\s*SELECT\b/i.test(query))) {
    throw new CanaryFailure("startup_preflight", "preflight_not_read_only");
  }
}

async function insertAndReadOutbox(
  db: {
    insert: (table: unknown) => {
      values: (values: unknown) => {
        returning: () => Promise<unknown[]>;
      };
    };
  },
  outboxTable: unknown,
): Promise<void> {
  const inserted = await db
    .insert(outboxTable)
    .values({
      id: OUTBOX_ID,
      projectId: LEGACY_PROJECT_ID,
      sessionId: LEGACY_SESSION_ID,
      turnId: "legacy-memory-canary-turn",
      responseText: "The durable outbox payload is readable.",
      nextAttemptAt: new Date("2026-01-04T13:00:00.000Z"),
    })
    .returning();
  if (inserted.length !== 1) {
    throw new CanaryFailure("verification", "outbox_insert_failed");
  }
}

async function main(): Promise<void> {
  const maintenanceUrl = requireEnvironment(
    "SCHEMA_CANARY_MAINTENANCE_DATABASE_URL",
  );
  const invokingUrl = requireEnvironment("DATABASE_URL");
  const maintenance = parseDatabaseUrl(
    maintenanceUrl,
    "SCHEMA_CANARY_MAINTENANCE_DATABASE_URL",
  );
  const invoking = parseDatabaseUrl(invokingUrl, "DATABASE_URL");
  if (databaseIdentity(maintenanceUrl) === databaseIdentity(invokingUrl)) {
    throw new CanaryFailure("configuration", "maintenance_database_is_invoking_database");
  }
  if (
    maintenance.database === invoking.database ||
    /^(workspace|release|engineeringos_test)$/i.test(maintenance.database)
  ) {
    throw new CanaryFailure("configuration", "maintenance_database_is_shared_database");
  }
  const releaseLock = await acquireLock();
  const databaseName = createDatabaseName();
  const disposableUrl = buildDisposableDatabaseUrl(maintenanceUrl, databaseName);
  const maintenanceClient = new Client({
    connectionString: maintenanceUrl,
    connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
  });
  let disposableClient: Client | undefined;
  let closeDbPool: (() => Promise<void>) | undefined;
  let databaseCreated = false;
  try {
    await connectOrFail(
      maintenanceClient,
      "setup",
      "maintenance_database_unavailable",
    );
    try {
      await maintenanceClient.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      );
    } catch {
      throw new CanaryFailure("setup", "disposable_database_create_failed");
    }
    databaseCreated = true;

    disposableClient = new Client({
      connectionString: disposableUrl,
      connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
    });
    await connectOrFail(
      disposableClient,
      "setup",
      "disposable_database_unavailable",
    );
    const legacyRows = await createLegacyFixture(disposableClient);
    await assertLegacyShapeBeforeDelivery(disposableClient);
    await disposableClient.end();
    disposableClient = undefined;

    await runSchemaDelivery(disposableUrl, "first_delivery");

    // Importing the application database module only after replacing the
    // process-local URL ensures its Drizzle pool can never target the caller's
    // workspace database.
    process.env.DATABASE_URL = disposableUrl;
    const dbModule = await import("./index.js");
    closeDbPool = () => dbModule.pool.end();
    const contractModule = await import("./application-schema-check.js");
    const upgradedClient = await dbModule.pool.connect();
    try {
      await assertReadOnlyContract(
        upgradedClient,
        contractModule.assertApplicationSchemaWithClient,
      );
      const memoryRows = await readMemoryRows(upgradedClient);
      assertEqual(
        memoryRows.map((row) => ({
          id: row.id,
          projectId: row.projectId,
          sessionId: row.sessionId,
          memoryType: row.memoryType,
          content: row.content,
          sourcePath: row.sourcePath,
          relevance: row.relevance,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        })),
        legacyRows,
        "legacy_memory_values_changed",
      );
      assertEqual(
        memoryRows.map((row) => [
          row.dedupeKey,
          row.semanticKind,
          row.scope,
          row.turnId,
          row.provenance,
          row.sourceReference,
          row.sourceRevision,
          row.confidence,
          row.confirmationStatus,
          row.freshnessStatus,
          row.lastDecayAt,
        ]),
        memoryRows.map(() => MODERN_MEMORY_COLUMNS.map(() => null)),
        "legacy_memory_metadata_not_null",
      );
    } finally {
      upgradedClient.release();
    }

    await insertAndReadOutbox(dbModule.db, dbModule.aiSessionMemoryOutboxTable);
    const outboxBeforeSecondDelivery = await readOutboxRows(dbModule.pool);
    const memoryBeforeSecondDelivery = await readMemoryRows(dbModule.pool);
    assertEqual(
      outboxBeforeSecondDelivery,
      [
        {
          id: OUTBOX_ID,
          projectId: LEGACY_PROJECT_ID,
          sessionId: LEGACY_SESSION_ID,
          turnId: "legacy-memory-canary-turn",
          toolSources: [],
          responseText: "The durable outbox payload is readable.",
          semanticRecords: [],
          attempts: 0,
          nextAttemptAt: "2026-01-04T13:00:00.000Z",
          createdAt: outboxBeforeSecondDelivery[0]?.createdAt,
        },
      ],
      "outbox_round_trip_changed",
    );

    await runSchemaDelivery(disposableUrl, "second_delivery");
    const idempotencyClient = await dbModule.pool.connect();
    try {
      await assertReadOnlyContract(
        idempotencyClient,
        contractModule.assertApplicationSchemaWithClient,
      );
      assertEqual(
        await readMemoryRows(idempotencyClient),
        memoryBeforeSecondDelivery,
        "memory_idempotency_changed",
      );
      assertEqual(
        await readOutboxRows(idempotencyClient),
        outboxBeforeSecondDelivery,
        "outbox_idempotency_changed",
      );
    } finally {
      idempotencyClient.release();
    }
    console.log(
      JSON.stringify({
        scope: "legacy-memory-schema-canary",
        outcome: "passed",
        deliveryRuns: 2,
        legacyMemoryRows: legacyRows.length,
        outboxRows: 1,
        startupPreflight: "read_only",
      }),
    );
  } finally {
    if (closeDbPool) await closeDbPool().catch(() => undefined);
    if (disposableClient) await disposableClient.end().catch(() => undefined);
    await maintenanceClient.end().catch(() => undefined);
    if (databaseCreated) {
      const cleanupClient = new Client({
        connectionString: maintenanceUrl,
        connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
      });
      try {
        await connectOrFail(
          cleanupClient,
          "cleanup",
          "cleanup_database_unavailable",
        );
        try {
          await cleanupClient.query(
            `DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`,
          );
        } catch {
          throw new CanaryFailure("cleanup", "disposable_database_drop_failed");
        }
      } finally {
        await cleanupClient.end().catch(() => undefined);
        await releaseLock();
      }
    } else {
      await releaseLock();
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof CanaryFailure) {
    console.error(
      JSON.stringify({
        scope: "legacy-memory-schema-canary",
        outcome: "failed",
        phase: error.phase,
        issueKind: error.issueKind,
      }),
    );
  } else {
    console.error(
      JSON.stringify({
        scope: "legacy-memory-schema-canary",
        outcome: "failed",
        phase: "unexpected",
        issueKind: "unclassified_failure",
      }),
    );
  }
  process.exitCode = 1;
}