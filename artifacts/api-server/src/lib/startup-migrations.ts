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
import { db, pool } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import { logger } from "./logger";

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
export async function scrubHistoricalValidationDetails(): Promise<void> {
  try {
    const messages = await pool.query<{
      id: string;
      tool_trace: string | null;
    }>("SELECT id, tool_trace FROM ai_chat_messages WHERE tool_trace IS NOT NULL");
    for (const row of messages.rows) {
      const scrubbed = scrubHistoricalJson(row.tool_trace);
      if (scrubbed !== row.tool_trace) {
        await pool.query(
          "UPDATE ai_chat_messages SET tool_trace = $1 WHERE id = $2 AND tool_trace = $3",
          [scrubbed, row.id, row.tool_trace],
        );
      }
    }

    const executions = await pool.query<{
      id: string;
      checkpoint: string;
    }>("SELECT id, checkpoint FROM ai_executions WHERE checkpoint IS NOT NULL");
    for (const row of executions.rows) {
      const scrubbed = scrubHistoricalJson(row.checkpoint);
      if (scrubbed !== row.checkpoint) {
        await pool.query(
          "UPDATE ai_executions SET checkpoint = $1 WHERE id = $2 AND checkpoint = $3",
          [scrubbed, row.id, row.checkpoint],
        );
      }
    }
  } catch (err) {
    logger.error({ scope: "startup-migrations", fn: "scrubHistoricalValidationDetails", err },
      "Failed to scrub historical validation details — will retry on the next startup");
  }
}

/**
 * Apply the bounded operational-diagnostics retention policy. This is
 * best-effort and safe on every startup: updates compare the original value,
 * so already-compacted rows are not rewritten and concurrent writers are not
 * overwritten.
 */
export async function pruneHistoricalAiDiagnostics(now = new Date()): Promise<void> {
  try {
    const chatCutoff = new Date(now.getTime() - AI_CHAT_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const messages = await pool.query<{
      id: string;
      tool_trace: string | null;
    }>(
      "SELECT id, tool_trace FROM ai_chat_messages WHERE created_at < $1 AND tool_trace IS NOT NULL",
      [chatCutoff],
    );
    for (const row of messages.rows) {
      if (!row.tool_trace) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.tool_trace);
      } catch {
        // Opaque values cannot be safely interpreted; leave them untouched.
        continue;
      }
      const retained = JSON.stringify(retainHistoricalValidationMetadata(parsed));
      if (retained !== row.tool_trace) {
        await pool.query(
          "UPDATE ai_chat_messages SET tool_trace = $1 WHERE id = $2 AND tool_trace = $3",
          [retained, row.id, row.tool_trace],
        );
      }
    }

    const executionCutoff = new Date(now.getTime() - AI_EXECUTION_CHECKPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const executions = await pool.query<{
      id: string;
      checkpoint: string;
    }>(
      "SELECT id, checkpoint FROM ai_executions WHERE updated_at < $1 AND status IN ('cancelled', 'completed', 'failed') AND checkpoint IS NOT NULL",
      [executionCutoff],
    );
    for (const row of executions.rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.checkpoint);
      } catch {
        continue;
      }
      const retained = JSON.stringify(retainHistoricalCheckpoint(parsed));
      if (retained !== row.checkpoint) {
        await pool.query(
          "UPDATE ai_executions SET checkpoint = $1 WHERE id = $2 AND checkpoint = $3",
          [retained, row.id, row.checkpoint],
        );
      }
    }
  } catch (err) {
    logger.error({ scope: "startup-migrations", fn: "pruneHistoricalAiDiagnostics", err },
      "Failed to prune historical AI diagnostics — will retry on the next startup");
  }
}
