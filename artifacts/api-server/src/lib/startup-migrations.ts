/**
 * Startup migrations — lightweight data corrections that run once per process
 * start, before the server begins accepting traffic.
 *
 * Rules:
 * - Every function MUST be async and MUST NOT throw (catch internally and log).
 * - Keep each migration idempotent — safe to run on every restart.
 * - No DDL here; schema changes go through Replit's publish-time migration flow.
 */

import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { db, pool } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import { logger } from "./logger";
import {
  getTaskExecutionRetentionHealth,
  pruneTaskExecutionHistory,
  TASK_HISTORY_RETENTION_BATCH_SIZE,
} from "./task-execution-retention.js";
import { pruneExpiredAiUsage } from "./ai-telemetry.js";

/** Canonical workspace root used in both dev and Replit production containers. */
const WORKSPACE_ROOT = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";

/** Path where an auto-generated encryption key is persisted across restarts. */
const ENCRYPTION_KEY_FILE = `${WORKSPACE_ROOT}/.local/encryption.key`;

/**
 * Ensures AI_CREDENTIALS_ENCRYPTION_KEY is set before the server accepts traffic.
 *
 * Resolution order:
 *   1. Already in process.env — nothing to do.
 *   2. Persisted in ENCRYPTION_KEY_FILE — load and set in process.env.
 *   3. Neither — generate a fresh 32-byte (64 hex char) key, persist it to
 *      ENCRYPTION_KEY_FILE, and set it in process.env for this process.
 *
 * The key file lives in .local/ (which should be in .gitignore) so it survives
 * Replit restarts without being committed to source control.
 *
 * Never throws — a failure here logs a warning; the credential routes already
 * return 500 with a clear message when the key is missing.
 */
export async function ensureEncryptionKey(): Promise<void> {
  const ENV_KEY = "AI_CREDENTIALS_ENCRYPTION_KEY";

  // 1. Already configured — nothing to do.
  if (process.env[ENV_KEY] && process.env[ENV_KEY]!.length === 64) return;

  try {
    // 2. Persisted key file exists — load it.
    const stored = (await fs.readFile(ENCRYPTION_KEY_FILE, "utf8")).trim();
    if (stored.length === 64 && /^[0-9a-f]+$/i.test(stored)) {
      process.env[ENV_KEY] = stored;
      logger.info({ scope: "startup-migrations", fn: "ensureEncryptionKey" },
        "Loaded AI credential encryption key from persistent key file");
      return;
    }
    logger.warn({ scope: "startup-migrations", fn: "ensureEncryptionKey", storedLength: stored.length },
      "Key file exists but is not a valid 64-char hex string — regenerating");
  } catch {
    // File does not exist yet — fall through to generate.
  }

  // 3. Generate a new key and persist it.
  try {
    const newKey = randomBytes(32).toString("hex");
    await fs.mkdir(`${WORKSPACE_ROOT}/.local`, { recursive: true });
    await fs.writeFile(ENCRYPTION_KEY_FILE, newKey, { mode: 0o600 });
    process.env[ENV_KEY] = newKey;
    logger.info({ scope: "startup-migrations", fn: "ensureEncryptionKey", keyFile: ENCRYPTION_KEY_FILE },
      "Generated and persisted new AI credential encryption key — credential storage is now active");
  } catch (err) {
    logger.error({ scope: "startup-migrations", fn: "ensureEncryptionKey", err },
      "Failed to generate/persist encryption key — credential storage will be unavailable until AI_CREDENTIALS_ENCRYPTION_KEY is set manually");
  }
}

/**
 * Projects imported via a legacy temporary git clone (GitHub discovery before
 * durable materialization) have a root_path like `/tmp/eos-git-<uuid>`. That
 * directory is deleted after discovery completes, so such a project can no
 * longer be scanned or read.
 *
 * This function ONLY reports these projects. It deliberately does NOT rewrite
 * root_path — the previous behaviour rebound dead roots to the workspace,
 * which made subsequent scans walk unrelated code and publish findings to the
 * wrong project. The persisted root is left untouched; a scan against it
 * fails explicitly with `root_unavailable` (see scan-runner.ts /
 * project-root.ts), and the user recovers by re-importing via discovery.
 *
 * Idempotent and read-only: safe to run on every restart.
 */
export async function reportDeadRootPaths(): Promise<void> {
  try {
    const legacyTempProjects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, rootPath: projectsTable.rootPath })
      .from(projectsTable)
      .where(like(projectsTable.rootPath, "/tmp/eos-git-%"));

    if (legacyTempProjects.length === 0) return;

    const dead: typeof legacyTempProjects = [];
    for (const p of legacyTempProjects) {
      try {
        await fs.access(p.rootPath);
      } catch {
        dead.push(p);
      }
    }

    if (dead.length === 0) return;

    logger.warn(
      {
        scope: "startup-migrations",
        fn: "reportDeadRootPaths",
        count: dead.length,
        projects: dead.map((p) => ({ id: p.id, rootPath: p.rootPath })),
      },
      `${dead.length} project(s) point at dead temporary clone roots — scans will fail with root_unavailable until they are re-imported via discovery`,
    );
  } catch (err) {
    logger.error({ scope: "startup-migrations", fn: "reportDeadRootPaths", err },
      "Failed to report dead root_paths — continuing startup");
  }
}

type HistoricalJsonRecord = Record<string, unknown>;

const VALIDATION_PUBLIC_KEYS = new Set([
  "profile",
  "status",
  "scenario",
  "exitCode",
  "evidence",
]);

/**
 * Retention policy for operational AI diagnostics:
 * - Chat tool traces older than 90 days retain only public validation status,
 *   proof evidence, and exit codes. All provider/tool output is removed.
 * - Terminal execution checkpoints older than 30 days retain their terminal
 *   stage, sequence, proof verdict, and validation metadata, but not the
 *   resumable progress trace.
 *
 * User-visible chat content, task results, outcomes, error codes, and the
 * execution rows themselves are not deleted by this policy. This means proof
 * status and exit-code metadata remain available in history while operational
 * traces have a bounded lifetime.
 */
export const AI_CHAT_TRACE_RETENTION_DAYS = 90;
export const AI_EXECUTION_CHECKPOINT_RETENTION_DAYS = 30;

export type AiDiagnosticsRetentionStatus = "success" | "failed";

export interface AiDiagnosticsRetentionHealth {
  status: AiDiagnosticsRetentionStatus;
  attemptedAt: string | null;
  completedAt: string | null;
  chatRowsScanned: number;
  chatRowsPruned: number;
  executionRowsScanned: number;
  executionRowsPruned: number;
}

export const STARTUP_MAINTENANCE_BATCH_SIZE = 200;
const STARTUP_MAINTENANCE_LOCK_SQL =
  "SELECT pg_try_advisory_xact_lock(7311202606::bigint) AS locked";
const STARTUP_MAINTENANCE_JOBS = [
  "scrub_chat_validation_v1",
  "scrub_execution_validation_v1",
  "prune_chat_diagnostics_v1",
  "prune_execution_diagnostics_v1",
] as const;
const STARTUP_MAINTENANCE_GATE_JOBS = STARTUP_MAINTENANCE_JOBS;
const STARTUP_MAINTENANCE_IDLE_DELAY_MS = 30_000;
const STARTUP_MAINTENANCE_BUSY_DELAY_MS = 250;

type MaintenanceJobKey = (typeof STARTUP_MAINTENANCE_JOBS)[number];
type MaintenanceCursor = {
  cursor_at: Date | string | null;
  cursor_id: string | null;
  completed_at: Date | string | null;
};
type MaintenanceBatchResult = {
  complete: boolean;
  full: boolean;
  scanned: number;
  pruned: number;
};

let startupMaintenanceReady = true;

export function getStartupMaintenanceReadiness():
  | { status: "ready" }
  | { status: "blocked"; reason: "historical_maintenance_in_progress" } {
  return startupMaintenanceReady
    ? { status: "ready" }
    : { status: "blocked", reason: "historical_maintenance_in_progress" };
}

async function refreshStartupMaintenanceReadiness(): Promise<boolean> {
  try {
    const result = await pool.query<{ maintenance_key: string }>(
      `SELECT maintenance_key
       FROM startup_maintenance_state
       WHERE maintenance_key = ANY($1::text[])
         AND completed_at IS NOT NULL`,
      [STARTUP_MAINTENANCE_GATE_JOBS],
    );
    const completed = new Set(result.rows.map((row) => row.maintenance_key));
    startupMaintenanceReady = STARTUP_MAINTENANCE_GATE_JOBS.every((key) =>
      completed.has(key),
    );
  } catch (error) {
    startupMaintenanceReady = false;
    logger.error(
      { scope: "startup-migrations", fn: "refreshStartupMaintenanceReadiness", err: error },
      "Could not read historical maintenance progress",
    );
  }
  return startupMaintenanceReady;
}

export async function initializeStartupMaintenance(): Promise<void> {
  startupMaintenanceReady = false;
  const values = STARTUP_MAINTENANCE_JOBS.map((_, index) => `($${index + 1})`).join(", ");
  try {
    await pool.query(
      `INSERT INTO startup_maintenance_state (maintenance_key)
       VALUES ${values}
       ON CONFLICT (maintenance_key) DO NOTHING`,
      [...STARTUP_MAINTENANCE_JOBS],
    );
    await refreshStartupMaintenanceReadiness();
  } catch (error) {
    logger.error(
      { scope: "startup-migrations", fn: "initializeStartupMaintenance", err: error },
      "Historical maintenance could not be initialized",
    );
  }
}

async function withMaintenanceCursor(
  jobKey: MaintenanceJobKey,
  operation: (client: PoolClient, cursor: MaintenanceCursor) => Promise<MaintenanceBatchResult>,
): Promise<MaintenanceBatchResult | null> {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const lock = await client.query<{ locked: boolean }>(STARTUP_MAINTENANCE_LOCK_SQL);
    if (!lock.rows[0]?.locked) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return null;
    }
    await client.query(
      `INSERT INTO startup_maintenance_state (maintenance_key)
       VALUES ($1)
       ON CONFLICT (maintenance_key) DO NOTHING`,
      [jobKey],
    );
    const state = await client.query<MaintenanceCursor>(
      `SELECT cursor_at, cursor_id, completed_at
       FROM startup_maintenance_state
       WHERE maintenance_key = $1
       FOR UPDATE`,
      [jobKey],
    );
    if (!state.rows[0]) throw new Error("maintenance_cursor_unavailable");
    const result = await operation(client, state.rows[0]);
    await client.query("COMMIT");
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function runValidationScrubBatch(
  jobKey: "scrub_chat_validation_v1" | "scrub_execution_validation_v1",
): Promise<MaintenanceBatchResult> {
  const table = jobKey === "scrub_chat_validation_v1" ? "ai_chat_messages" : "ai_executions";
  const column = jobKey === "scrub_chat_validation_v1" ? "tool_trace" : "checkpoint";
  const result = await withMaintenanceCursor(jobKey, async (client, cursor) => {
    if (cursor.completed_at) {
      return { complete: true, full: false, scanned: 0, pruned: 0 };
    }
    const selected = await client.query<{ id: string; payload: string }>(
      `SELECT id, ${column} AS payload
       FROM ${table}
       WHERE ${column} IS NOT NULL
         AND ($1 IS NULL OR id > $1)
       ORDER BY id
       LIMIT $2`,
      [cursor.cursor_id, STARTUP_MAINTENANCE_BATCH_SIZE],
    );
    for (const row of selected.rows) {
      const scrubbed = scrubHistoricalJson(row.payload);
      if (scrubbed !== row.payload) {
        await client.query(
          `UPDATE ${table}
           SET ${column} = $1
           WHERE id = $2 AND ${column} = $3`,
          [scrubbed, row.id, row.payload],
        );
      }
    }
    const complete = selected.rows.length < STARTUP_MAINTENANCE_BATCH_SIZE;
    const lastId = selected.rows.at(-1)?.id ?? cursor.cursor_id;
    await client.query(
      `UPDATE startup_maintenance_state
       SET cursor_id = $2,
           completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE completed_at END,
           updated_at = now()
       WHERE maintenance_key = $1`,
      [jobKey, lastId, complete],
    );
    return {
      complete,
      full: selected.rows.length === STARTUP_MAINTENANCE_BATCH_SIZE,
      scanned: selected.rows.length,
      pruned: 0,
    };
  });
  return result ?? { complete: false, full: false, scanned: 0, pruned: 0 };
}

async function runChatDiagnosticsBatch(now: Date): Promise<MaintenanceBatchResult> {
  const jobKey = "prune_chat_diagnostics_v1";
  const result = await withMaintenanceCursor(jobKey, async (client, cursor) => {
    const cutoff = new Date(now.getTime() - AI_CHAT_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const selected = await client.query<{
      id: string;
      payload: string;
      cursor_at: Date;
    }>(
      `SELECT id, tool_trace AS payload, created_at AS cursor_at
       FROM ai_chat_messages
       WHERE created_at < $1
         AND tool_trace IS NOT NULL
         AND ($2 IS NULL OR (created_at, id) > ($2, $3))
       ORDER BY created_at, id
       LIMIT $4`,
      [cutoff, cursor.cursor_at, cursor.cursor_id, STARTUP_MAINTENANCE_BATCH_SIZE],
    );
    let pruned = 0;
    for (const row of selected.rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.payload);
      } catch {
        continue;
      }
      const retained = JSON.stringify(retainHistoricalValidationMetadata(parsed));
      if (retained !== row.payload) {
        const updated = await client.query(
          `UPDATE ai_chat_messages
           SET tool_trace = $1
           WHERE id = $2 AND tool_trace = $3`,
          [retained, row.id, row.payload],
        );
        if (updated.rowCount === 1) pruned++;
      }
    }
    const complete = selected.rows.length < STARTUP_MAINTENANCE_BATCH_SIZE;
    const last = selected.rows.at(-1);
    await client.query(
      `UPDATE startup_maintenance_state
       SET cursor_at = COALESCE($2, cursor_at),
           cursor_id = COALESCE($3, cursor_id),
           completed_at = CASE WHEN $4 THEN COALESCE(completed_at, now()) ELSE completed_at END,
           updated_at = now()
       WHERE maintenance_key = $1`,
      [jobKey, last?.cursor_at ?? null, last?.id ?? null, complete],
    );
    return {
      complete,
      full: selected.rows.length === STARTUP_MAINTENANCE_BATCH_SIZE,
      scanned: selected.rows.length,
      pruned,
    };
  });
  return result ?? { complete: false, full: false, scanned: 0, pruned: 0 };
}

async function runExecutionDiagnosticsBatch(now: Date): Promise<MaintenanceBatchResult> {
  const jobKey = "prune_execution_diagnostics_v1";
  const result = await withMaintenanceCursor(jobKey, async (client, cursor) => {
    const cutoff = new Date(now.getTime() - AI_EXECUTION_CHECKPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const selected = await client.query<{
      id: string;
      payload: string;
      cursor_at: Date;
    }>(
      `SELECT id, checkpoint AS payload, updated_at AS cursor_at
       FROM ai_executions
       WHERE updated_at < $1
         AND status IN ('cancelled', 'completed', 'failed')
         AND checkpoint IS NOT NULL
         AND ($2 IS NULL OR (updated_at, id) > ($2, $3))
       ORDER BY updated_at, id
       LIMIT $4`,
      [cutoff, cursor.cursor_at, cursor.cursor_id, STARTUP_MAINTENANCE_BATCH_SIZE],
    );
    let pruned = 0;
    for (const row of selected.rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.payload);
      } catch {
        continue;
      }
      const retained = JSON.stringify(retainHistoricalCheckpoint(parsed));
      if (retained !== row.payload) {
        const updated = await client.query(
          `UPDATE ai_executions
           SET checkpoint = $1
           WHERE id = $2 AND checkpoint = $3`,
          [retained, row.id, row.payload],
        );
        if (updated.rowCount === 1) pruned++;
      }
    }
    const complete = selected.rows.length < STARTUP_MAINTENANCE_BATCH_SIZE;
    const last = selected.rows.at(-1);
    await client.query(
      `UPDATE startup_maintenance_state
       SET cursor_at = COALESCE($2, cursor_at),
           cursor_id = COALESCE($3, cursor_id),
           completed_at = CASE WHEN $4 THEN COALESCE(completed_at, now()) ELSE completed_at END,
           updated_at = now()
       WHERE maintenance_key = $1`,
      [jobKey, last?.cursor_at ?? null, last?.id ?? null, complete],
    );
    return {
      complete,
      full: selected.rows.length === STARTUP_MAINTENANCE_BATCH_SIZE,
      scanned: selected.rows.length,
      pruned,
    };
  });
  return result ?? { complete: false, full: false, scanned: 0, pruned: 0 };
}

function recordDiagnosticsBatch(
  chat: MaintenanceBatchResult,
  execution: MaintenanceBatchResult,
  now: Date,
): void {
  aiDiagnosticsRetentionHealth.status = "success";
  aiDiagnosticsRetentionHealth.attemptedAt = now.toISOString();
  aiDiagnosticsRetentionHealth.chatRowsScanned += chat.scanned;
  aiDiagnosticsRetentionHealth.chatRowsPruned += chat.pruned;
  aiDiagnosticsRetentionHealth.executionRowsScanned += execution.scanned;
  aiDiagnosticsRetentionHealth.executionRowsPruned += execution.pruned;
  if (chat.complete && execution.complete) {
    aiDiagnosticsRetentionHealth.completedAt = now.toISOString();
  }
}

const aiDiagnosticsRetentionHealth: AiDiagnosticsRetentionHealth = {
  status: "failed",
  attemptedAt: null,
  completedAt: null,
  chatRowsScanned: 0,
  chatRowsPruned: 0,
  executionRowsScanned: 0,
  executionRowsPruned: 0,
};

/** Return content-free status for the most recent retention attempt. */
export function getAiDiagnosticsRetentionHealth(): AiDiagnosticsRetentionHealth {
  return { ...aiDiagnosticsRetentionHealth };
}

/**
 * Remove validation payloads written before the public validation contract was
 * enforced. This deliberately uses an allow-list rather than redaction: test
 * output and failure messages are arbitrary source-controlled text and cannot
 * be made safe with a few regular expressions.
 */
export function scrubHistoricalValidationRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => scrubHistoricalValidationRecord(item));
  if (!value || typeof value !== "object") return value;
  const record = value as HistoricalJsonRecord;
  const acceptanceCheckId = record.id;
  const acceptanceCheckKind = record.kind;
  const acceptanceCheckDescription = record.description;
  const acceptanceCheckRequired = record.required;
  if (
    typeof acceptanceCheckId === "string"
    && typeof acceptanceCheckKind === "string"
    && ["scope", "behavior", "validation", "evidence"].includes(acceptanceCheckKind)
    && typeof acceptanceCheckDescription === "string"
    && typeof acceptanceCheckRequired === "boolean"
  ) {
    // Autonomous-operation acceptance checks use kind="validation" too, but
    // are contract metadata rather than raw validation-result details.
    return {
      id: acceptanceCheckId.slice(0, 120),
      kind: acceptanceCheckKind,
      description: acceptanceCheckDescription.slice(0, 500),
      required: acceptanceCheckRequired,
    };
  }
  const isValidation = record.kind === "validation";
  const nestedValidation = record.validation;

  if (isValidation) {
    const result: HistoricalJsonRecord = {};
    for (const key of ["kind", "repairState", "attempt", "maxAttempts"]) {
      if (key in record) result[key] = record[key];
    }
    if (nestedValidation && typeof nestedValidation === "object" && !Array.isArray(nestedValidation)) {
      const publicValidation: HistoricalJsonRecord = {};
      for (const key of VALIDATION_PUBLIC_KEYS) {
        if (key in (nestedValidation as HistoricalJsonRecord)) {
          publicValidation[key] = (nestedValidation as HistoricalJsonRecord)[key];
        }
      }
      result.validation = publicValidation;
    } else {
      // Legacy traces stored these fields directly on the step.
      for (const [legacyKey, publicKey] of [
        ["profile", "profile"],
        ["validationProfile", "profile"],
        ["scenario", "scenario"],
        ["validationScenario", "scenario"],
        ["status", "status"],
        ["validationStatus", "status"],
        ["exitCode", "exitCode"],
        ["validationExitCode", "exitCode"],
      ]) {
        if (!(publicKey in result) && legacyKey in record) result[publicKey] = record[legacyKey];
      }
      if (Object.keys(result).some((key) => VALIDATION_PUBLIC_KEYS.has(key))) {
        const publicValidation: HistoricalJsonRecord = {};
        for (const key of VALIDATION_PUBLIC_KEYS) {
          if (key in result) publicValidation[key] = result[key];
        }
        result.validation = publicValidation;
        for (const key of VALIDATION_PUBLIC_KEYS) delete result[key];
      }
    }
    return result;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      Array.isArray(child)
        ? child.map((item) => scrubHistoricalValidationRecord(item))
        : scrubHistoricalValidationRecord(child),
    ]),
  );
}

/**
 * Produce the intentionally small representation retained from an old chat
 * trace. Validation records are the only trace entries that can contribute to
 * the user-visible proof panel; arbitrary tool/provider records are discarded.
 */
export function retainHistoricalValidationMetadata(value: unknown): unknown {
  const scrubbed = scrubHistoricalValidationRecord(value);
  if (Array.isArray(scrubbed)) {
    return scrubbed.filter(
      (item): item is HistoricalJsonRecord =>
        Boolean(item && typeof item === "object" && !Array.isArray(item) && (item as HistoricalJsonRecord).kind === "validation"),
    );
  }
  if (scrubbed && typeof scrubbed === "object" && (scrubbed as HistoricalJsonRecord).kind === "validation") {
    return scrubbed;
  }
  return [];
}

/**
 * Compact an old terminal checkpoint without losing the proof/validation
 * metadata needed to explain its outcome. This is pure so the retention
 * contract can be tested without mutating a database.
 */
export function retainHistoricalCheckpoint(value: unknown): unknown {
  const scrubbed = scrubHistoricalValidationRecord(value);
  if (!scrubbed || typeof scrubbed !== "object" || Array.isArray(scrubbed)) return scrubbed;
  const record = scrubbed as HistoricalJsonRecord;
  const retained: HistoricalJsonRecord = {};
  for (const key of ["stage", "sequence", "updatedAt", "evidenceVerdict", "evidenceReason", "proofRequired"]) {
    if (key in record) retained[key] = record[key];
  }
  const validationMetadata = retainHistoricalValidationMetadata(record.recentSteps);
  if (Array.isArray(validationMetadata) && validationMetadata.length > 0) {
    retained.recentSteps = validationMetadata;
  }
  return retained;
}

function scrubHistoricalJson(raw: string | null): string | null {
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw);
    const scrubbed = scrubHistoricalValidationRecord(parsed);
    // Avoid rewriting already-safe rows merely because their JSON whitespace
    // differs; this keeps the migration genuinely idempotent.
    return JSON.stringify(scrubbed) === JSON.stringify(parsed)
      ? raw
      : JSON.stringify(scrubbed);
  } catch {
    // An opaque legacy value is not safe to reinterpret or partially edit.
    return raw;
  }
}

/**
 * One-time-in-effect, repeatable data migration for records created before
 * validation output was excluded from durable chat history. It is intentionally
 * best-effort so a transient database issue cannot prevent the API from
 * starting; a later restart retries unchanged rows.
 */
export async function scrubHistoricalValidationDetails(): Promise<boolean> {
  try {
    const chat = await runValidationScrubBatch("scrub_chat_validation_v1");
    const executions = await runValidationScrubBatch("scrub_execution_validation_v1");
    await refreshStartupMaintenanceReadiness();
    return chat.complete && executions.complete;
  } catch (err) {
    startupMaintenanceReady = false;
    logger.error(
      { scope: "startup-migrations", fn: "scrubHistoricalValidationDetails", err },
      "Historical validation scrub failed; API routes remain blocked while it retries",
    );
    return false;
  }
}

/**
 * Apply the bounded operational-diagnostics retention policy. This is
 * best-effort and safe on every startup: updates compare the original value,
 * so already-compacted rows are not rewritten and concurrent writers are not
 * overwritten.
 */
export async function pruneHistoricalAiDiagnostics(now = new Date()): Promise<boolean> {
  try {
    const chat = await runChatDiagnosticsBatch(now);
    const execution = await runExecutionDiagnosticsBatch(now);
    recordDiagnosticsBatch(chat, execution, now);
    await refreshStartupMaintenanceReadiness();
    return chat.complete && execution.complete;
  } catch (err) {
    aiDiagnosticsRetentionHealth.status = "failed";
    aiDiagnosticsRetentionHealth.attemptedAt = now.toISOString();
    logger.error(
      { scope: "startup-migrations", fn: "pruneHistoricalAiDiagnostics", err },
      "Historical diagnostic cleanup failed; bounded batches will retry",
    );
    return false;
  }
}

export function startStartupMaintenanceWorker(): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped) return;
    let idle = false;
    try {
      const scrubComplete = await scrubHistoricalValidationDetails();
      const diagnosticsIdle = await pruneHistoricalAiDiagnostics();
      await pruneTaskExecutionHistory();
      const expiredUsageIdle = await pruneExpiredAiUsage();
      const taskHistory = getTaskExecutionRetentionHealth();
      idle = scrubComplete
        && diagnosticsIdle
        && expiredUsageIdle
        && taskHistory.taskLogRowsScanned < TASK_HISTORY_RETENTION_BATCH_SIZE
        && taskHistory.receiptRowsScanned < TASK_HISTORY_RETENTION_BATCH_SIZE;
    } catch (error) {
      logger.error(
        { scope: "startup-migrations", fn: "startStartupMaintenanceWorker", err: error },
        "Background startup maintenance pass failed",
      );
    }
    if (!stopped) {
      timer = setTimeout(
        run,
        idle ? STARTUP_MAINTENANCE_IDLE_DELAY_MS : STARTUP_MAINTENANCE_BUSY_DELAY_MS,
      );
    }
  };
  timer = setTimeout(run, STARTUP_MAINTENANCE_BUSY_DELAY_MS);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
