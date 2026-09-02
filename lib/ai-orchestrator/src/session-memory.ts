/**
 * Session Memory — cross-session knowledge persistence for the chat agent.
 *
 * At the end of every successful chat exchange the route calls
 * `writeSessionMemories()` to enqueue a durable, retryable write:
 *   • file_summary rows — one per file actually accessed via tool calls
 *   • session_summary  — compressed first paragraph of the agent's response
 *
 * At the start of the next exchange `enrichContextWithMemories()` fetches the
 * top-N eligible memories by relevance and recency, formats them into a readable string, and injects
 * it into the project context as `sessionMemories`.  The chat prompt builder
 * surfaces this as a dedicated section so the model can skip re-reading files
 * it has already analysed.
 *
 * Relevance decay:
 *   A maintenance sweep runs every six hours, but each row is decayed at most
 *   once per 24-hour period. Rows below 0.1 or past `expires_at` are deleted.
 *
 * Research basis: A-Mem (NeurIPS 2025) dynamic agentic memory architecture.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "@workspace/db";
import {
  aiSessionMemoriesTable,
  aiSessionMemoryOutboxTable,
  type InsertAiSessionMemory,
} from "@workspace/db";
import { and, asc, desc, eq, gt, isNull, lte, lt, or, sql } from "drizzle-orm";
import type { ProjectContext } from "./context-builder.js";
import type { ExecutionPlan } from "./model-selection/execution-plan.js";
import { formatUntrustedContent } from "./untrusted-content.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max file_summary rows written per session (keeps DB lean). */
const MAX_FILE_MEMORIES = 8;
/** Hard expiry for every new memory row (30 days). */
const MEMORY_TTL_DAYS = 30;
/** Max chars taken from the response text for a session_summary. */
const MAX_SUMMARY_CHARS = 400;
/** Relevance multiplied by this on every completed 24-hour decay period. */
const RELEVANCE_DECAY = 0.9;
/** Rows below this relevance threshold are deleted on sweep. */
const RELEVANCE_PRUNE_THRESHOLD = 0.1;
const MEMORY_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const OUTBOX_POLL_INTERVAL_MS = 30 * 1000;
const OUTBOX_BATCH_SIZE = 25;
const OUTBOX_RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 60_000];

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryRow = typeof aiSessionMemoriesTable.$inferSelect;
type MemoryPromptRow = Pick<
  MemoryRow,
  "id" | "projectId" | "sessionId" | "memoryType" | "content" | "sourcePath" | "relevance" | "createdAt" | "expiresAt"
> & Partial<Pick<MemoryRow, "dedupeKey" | "lastDecayAt">>;

export type MemoryPolicy = {
  mode: "none" | "summary" | "episodic";
  limit: number;
};

/** Return a safe project-relative path, or null for an absolute/traversal path. */
export function normalizeProjectRelativePath(value: string): string | null {
  const raw = value.trim().replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) return null;
  const normalized = raw.replace(/^(\.\/)+/, "").replace(/\/+/g, "/");
  const result = path.posix.normalize(normalized);
  return result === "." || result === ".." || result.startsWith("../") || result.startsWith("/")
    ? null
    : result;
}

function memoryDedupeKey(projectId: string, memoryType: string, sourcePath: string | null, sessionId: string): string {
  return sourcePath
    ? `${projectId}:file_summary:${sourcePath}`
    : `${projectId}:${memoryType}:${sessionId}`;
}

type MemoryWritePayload = {
  sessionId: string;
  projectId: string;
  turnId: string;
  toolSources: string[];
  responseText: string;
  createdAt: Date;
};

function buildMemoryRows(payload: MemoryWritePayload, now: Date): InsertAiSessionMemory[] {
  const expiresAt = new Date(now.getTime() + MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000);
  const filePaths = [...new Set(
    payload.toolSources
      .map(normalizeProjectRelativePath)
      .filter((value): value is string => Boolean(value))
      .filter((value) => value.includes("/") || /\.[a-zA-Z]{2,8}$/.test(value)),
  )].slice(0, MAX_FILE_MEMORIES);
  const rows: InsertAiSessionMemory[] = filePaths.map((sourcePath) => ({
    id: randomUUID(),
    projectId: payload.projectId,
    sessionId: payload.sessionId,
    memoryType: "file_summary",
    content: "Previously accessed and analyzed in a chat session.",
    sourcePath,
    dedupeKey: memoryDedupeKey(payload.projectId, "file_summary", sourcePath, payload.sessionId),
    relevance: 1.0,
    createdAt: now,
    expiresAt,
    lastDecayAt: null,
  }));

  const summary = payload.responseText
    .replace(/```[\s\S]*?```/g, "[code]")
    .split(/\n\s*\n/, 1)[0]!
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
  if (summary.length > 30) {
    rows.push({
      id: randomUUID(),
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      memoryType: "session_summary",
      content: summary,
      sourcePath: null,
      dedupeKey: memoryDedupeKey(payload.projectId, "session_summary", null, payload.sessionId),
      relevance: 0.85,
      createdAt: now,
      expiresAt,
      lastDecayAt: null,
    });
  }
  return rows;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

/**
 * Fetch eligible memories for a project. Relevance is balanced with recency,
 * and duplicate legacy rows are coalesced in memory until they expire.
 * Gracefully returns [] on any DB error, while emitting an operator diagnostic.
 */
export async function fetchSessionMemories(
  projectId: string,
  limit = 20,
  policy?: Readonly<MemoryPolicy>,
): Promise<MemoryRow[]> {
  const effectiveLimit = Math.max(0, Math.min(limit, policy?.limit ?? limit));
  if (!projectId || effectiveLimit <= 0 || policy?.mode === "none") return [];
  const now = new Date();
  try {
    const rows = await db
      .select()
      .from(aiSessionMemoriesTable)
      .where(
        and(
          eq(aiSessionMemoriesTable.projectId, projectId),
          or(
            isNull(aiSessionMemoriesTable.expiresAt),
            gt(aiSessionMemoriesTable.expiresAt, now),
          ),
        ),
      )
      .orderBy(desc(aiSessionMemoriesTable.relevance), desc(aiSessionMemoriesTable.createdAt))
      .limit(Math.max(effectiveLimit * 4, 20));
    const eligible = policy?.mode === "summary"
      ? rows.filter((row) => row.memoryType === "session_summary")
      : rows;
    const deduped = new Map<string, MemoryRow>();
    for (const row of eligible) {
      const key = row.dedupeKey ?? `${row.memoryType}:${row.sourcePath ?? row.sessionId}`;
      const previous = deduped.get(key);
      if (!previous || row.createdAt > previous.createdAt) deduped.set(key, row);
    }
    const maxCreatedAt = Math.max(
      now.getTime(),
      ...[...deduped.values()].map((row) => row.createdAt.getTime()),
    );
    return [...deduped.values()]
      .sort((a, b) => {
        const ageA = Math.max(0, maxCreatedAt - a.createdAt.getTime());
        const ageB = Math.max(0, maxCreatedAt - b.createdAt.getTime());
        const recencyA = 1 / (1 + ageA / (7 * 24 * 60 * 60 * 1000));
        const recencyB = 1 / (1 + ageB / (7 * 24 * 60 * 60 * 1000));
        const scoreA = a.relevance * 0.7 + recencyA * 0.3;
        const scoreB = b.relevance * 0.7 + recencyB * 0.3;
        return scoreB - scoreA
          || b.createdAt.getTime() - a.createdAt.getTime()
          || a.id.localeCompare(b.id);
      })
      .slice(0, effectiveLimit);
  } catch (err) {
    console.warn(JSON.stringify({
      scope: "session-memory",
      code: "MEMORY_RETRIEVAL_ERROR",
      projectId,
      error: String(err),
    }));
    return [];
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Persist memories extracted from a completed chat turn.
 *
 * This function only writes a durable outbox record. The outbox worker
 * materializes memory rows asynchronously, so model response latency is not
 * coupled to memory processing.
 *
 * @param sessionId    The chat session that just completed.
 * @param projectId    The project the session belongs to.
 * @param toolSources  Ground-truth file paths accessed during the turn.
 * @param responseText The agent's response text (used for session_summary).
 */
export async function writeSessionMemories(
  sessionId: string,
  projectId: string,
  toolSources: string[],
  responseText: string,
  turnId: string = randomUUID(),
): Promise<void> {
  const now = new Date();
  const payload: MemoryWritePayload = {
    sessionId,
    projectId,
    turnId,
    toolSources: toolSources.filter((value): value is string => typeof value === "string"),
    responseText,
    createdAt: now,
  };
  const rows = buildMemoryRows(payload, now);
  if (rows.length === 0) return;

  const outboxId = `${sessionId}:${turnId}`;
  await db.insert(aiSessionMemoryOutboxTable).values({
    id: outboxId,
    projectId,
    sessionId,
    turnId,
    toolSources: payload.toolSources,
    responseText: payload.responseText,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  }).onConflictDoNothing();

  console.info(
    JSON.stringify({
      scope: "session-memory",
      code: "MEMORY_WRITE_QUEUED",
      projectId,
      sessionId,
      turnId,
      filePaths: rows.filter((row) => row.memoryType === "file_summary").length,
      hasSummary: rows.some((row) => row.memoryType === "session_summary"),
    }),
  );
}

async function materializeMemoryWrite(payload: MemoryWritePayload): Promise<void> {
  const rows = buildMemoryRows(payload, payload.createdAt);
  for (const row of rows) {
    await db.insert(aiSessionMemoriesTable)
      .values(row)
      .onConflictDoUpdate({
        target: aiSessionMemoriesTable.dedupeKey,
        set: {
          sessionId: row.sessionId,
          content: row.content,
          sourcePath: row.sourcePath,
          relevance: row.relevance,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          lastDecayAt: null,
        },
      });
  }
}

/** Drain due durable writes. Safe to run concurrently because destination writes are idempotent. */
export async function drainSessionMemoryOutbox(): Promise<void> {
  let pending: Array<typeof aiSessionMemoryOutboxTable.$inferSelect>;
  try {
    pending = await db
      .select()
      .from(aiSessionMemoryOutboxTable)
      .where(lte(aiSessionMemoryOutboxTable.nextAttemptAt, new Date()))
      .orderBy(asc(aiSessionMemoryOutboxTable.nextAttemptAt))
      .limit(OUTBOX_BATCH_SIZE);
  } catch (err) {
    console.warn(JSON.stringify({
      scope: "session-memory",
      code: "MEMORY_OUTBOX_READ_ERROR",
      error: String(err),
    }));
    return;
  }

  await Promise.all(pending.map(async (entry) => {
    const payload: MemoryWritePayload = {
      sessionId: entry.sessionId,
      projectId: entry.projectId,
      turnId: entry.turnId,
      toolSources: entry.toolSources,
      responseText: entry.responseText,
      createdAt: entry.createdAt,
    };
    try {
      await materializeMemoryWrite(payload);
      await db.delete(aiSessionMemoryOutboxTable).where(eq(aiSessionMemoryOutboxTable.id, entry.id));
      console.info(JSON.stringify({
        scope: "session-memory",
        code: "MEMORY_WRITE_DELIVERED",
        projectId: entry.projectId,
        sessionId: entry.sessionId,
        turnId: entry.turnId,
      }));
    } catch (err) {
      const attempts = entry.attempts + 1;
      const delay = OUTBOX_RETRY_DELAYS_MS[Math.min(attempts - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)]!;
      try {
        await db.update(aiSessionMemoryOutboxTable)
          .set({ attempts, nextAttemptAt: new Date(Date.now() + delay) })
          .where(eq(aiSessionMemoryOutboxTable.id, entry.id));
      } catch (updateErr) {
        console.warn(JSON.stringify({
          scope: "session-memory",
          code: "MEMORY_OUTBOX_RETRY_STATE_ERROR",
          projectId: entry.projectId,
          turnId: entry.turnId,
          error: String(updateErr),
        }));
      }
      console.warn(JSON.stringify({
        scope: "session-memory",
        code: "MEMORY_WRITE_DELIVERY_ERROR",
        projectId: entry.projectId,
        sessionId: entry.sessionId,
        turnId: entry.turnId,
        attempts,
        error: String(err),
      }));
    }
  }));
}

// ── Context enrichment ────────────────────────────────────────────────────────

/**
 * Format fetched memories into a human-readable string for the system prompt.
 *
 * The bullet format (`• path`) is intentionally machine-parseable so
 * chat-agent.ts can extract file paths for speculative-prefetch without a
 * separate round-trip to the DB.
 *
 * Returns null when there are no memories (so callers can skip the section).
 */
export function formatMemoriesForPrompt(memories: MemoryPromptRow[]): string | null {
  if (memories.length === 0) return null;

  const fileMemories = memories.filter(
    (m) => m.memoryType === "file_summary" && m.sourcePath,
  );
  const summaryMemories = memories.filter(
    (m) => m.memoryType === "session_summary",
  );

  const lines: string[] = [];
  if (fileMemories.length > 0) {
    for (const m of fileMemories) {
      lines.push(`  • ${m.sourcePath}`);
    }
  }

  for (const memory of summaryMemories) {
    lines.push(`  [session_summary] ${memory.content.slice(0, 300)}`);
  }

  for (const memory of memories) {
    if (memory.memoryType === "file_summary" || memory.memoryType === "session_summary") continue;
    lines.push(`  [${memory.memoryType}] ${memory.content.slice(0, 300)}`);
  }

  const payload = [
    "Historical session memory is a navigation hint only; it may be stale and is not current evidence.",
    "Read current source or obtain current telemetry before making a present-tense claim.",
    ...lines,
  ].join("\n");
  const typeCounts = memories.reduce<Record<string, number>>((counts, memory) => {
    counts[memory.memoryType] = (counts[memory.memoryType] ?? 0) + 1;
    return counts;
  }, {});
  console.info(JSON.stringify({
    scope: "session-memory",
    code: "MEMORY_PROMPT_INJECTED",
    entryCount: memories.length,
    typeCounts,
  }));
  return formatUntrustedContent(payload, { source: "session_memory" });
}

/**
 * Fetch memories for a project and attach them to the mutable context object
 * as `sessionMemories`.  Called at the route level, after the cached context
 * is returned, so memories are always fresh and never pollute the cache.
 *
 * Safe to call with `.catch(() => {})` — any failure leaves the context
 * unchanged and the agent proceeds without memory context.
 */
export async function enrichContextWithMemories(
  context: ProjectContext & { sessionMemories?: string },
  projectId: string,
  plan?: Readonly<ExecutionPlan>,
): Promise<void> {
  const mode = plan?.taskProfile.memoryMode ?? "episodic";
  const limit = plan?.memoryDepth ?? 20;
  if (mode === "none" || limit === 0) {
    delete context.sessionMemories;
    return;
  }
  const memories = await fetchSessionMemories(projectId, limit, { mode, limit });
  const formatted = formatMemoriesForPrompt(memories);
  if (formatted) {
    context.sessionMemories = formatted;
  } else {
    delete context.sessionMemories;
  }
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Maintenance sweep (scheduled every six hours):
 *   1. Delete expired rows (expiresAt < now)
 *   2. Decay eligible rows once per completed 24-hour period
 *   3. Delete rows that have decayed below RELEVANCE_PRUNE_THRESHOLD
 *
 * Should be scheduled every 6–24 hours.  Never throws — all errors are
 * logged as warnings so startup/scheduling code can call it safely.
 */
export async function sweepExpiredMemories(): Promise<void> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  try {
    // 1. Delete hard-expired rows
    await db
      .delete(aiSessionMemoriesTable)
      .where(lt(aiSessionMemoriesTable.expiresAt, now));

    // 2. A row can only cross one decay boundary per 24 hours. The
    // lastDecayAt predicate is rechecked by PostgreSQL after row-lock waits,
    // so concurrent workers do not apply the same period twice.
    await db
      .update(aiSessionMemoriesTable)
      .set({
        relevance: sql<number>`GREATEST(0.0, ${aiSessionMemoriesTable.relevance} * ${RELEVANCE_DECAY})`,
        lastDecayAt: now,
      })
      .where(
        and(
          lt(aiSessionMemoriesTable.createdAt, oneDayAgo),
          or(
            isNull(aiSessionMemoriesTable.lastDecayAt),
            lt(aiSessionMemoriesTable.lastDecayAt, oneDayAgo),
          ),
          or(
            isNull(aiSessionMemoriesTable.expiresAt),
            gt(aiSessionMemoriesTable.expiresAt, now),
          ),
        ),
      );

    // 3. Prune decayed-out rows
    await db
      .delete(aiSessionMemoriesTable)
      .where(lt(aiSessionMemoriesTable.relevance, RELEVANCE_PRUNE_THRESHOLD));

    console.info(
      JSON.stringify({
        scope: "session-memory",
        code: "SWEEP_COMPLETE",
        ts: now.toISOString(),
      }),
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "session-memory",
        code: "SWEEP_ERROR",
        error: String(err),
      }),
    );
  }
}

/**
 * Start the periodic memory sweep scheduler.
 *
 * @param intervalMs  How often to run maintenance (default: every 6 hours).
 * @returns           A stop function that cancels the interval.
 */
export function startMemorySweep(
  intervalMs = MEMORY_SWEEP_INTERVAL_MS,
): { stop: () => void } {
  // Recover durable writes immediately after a restart, then clear retention
  // backlog. Materialization stays off the request path.
  drainSessionMemoryOutbox().catch(() => {});
  sweepExpiredMemories().catch(() => {});

  const handle = setInterval(() => {
    sweepExpiredMemories().catch(() => {});
  }, intervalMs);
  const outboxHandle = setInterval(() => {
    drainSessionMemoryOutbox().catch(() => {});
  }, OUTBOX_POLL_INTERVAL_MS);
  handle.unref?.();
  outboxHandle.unref?.();

  return {
    stop: () => {
      clearInterval(handle);
      clearInterval(outboxHandle);
    },
  };
}
