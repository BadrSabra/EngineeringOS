/**
 * Session Memory — cross-session knowledge persistence for the chat agent.
 *
 * At the end of every successful chat exchange the route calls
 * `writeSessionMemories()` (fire-and-forget) to persist:
 *   • file_summary rows — one per file actually accessed via tool calls
 *   • session_summary  — compressed first paragraph of the agent's response
 *
 * At the start of the next exchange `enrichContextWithMemories()` fetches the
 * top-N memories by relevance, formats them into a readable string, and injects
 * it into the project context as `sessionMemories`.  The chat prompt builder
 * surfaces this as a dedicated section so the model can skip re-reading files
 * it has already analysed.
 *
 * Relevance decay:
 *   The daily sweep reduces every row's relevance by 10% and deletes rows that
 *   drop below 0.1 or have passed their `expires_at` date.
 *
 * Research basis: A-Mem (NeurIPS 2025) dynamic agentic memory architecture.
 */

import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  aiSessionMemoriesTable,
  type InsertAiSessionMemory,
} from "@workspace/db";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { ProjectContext } from "./context-builder.js";
import { formatUntrustedContent } from "./untrusted-content.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max file_summary rows written per session (keeps DB lean). */
const MAX_FILE_MEMORIES = 8;
/** Hard expiry for every new memory row (30 days). */
const MEMORY_TTL_DAYS = 30;
/** Max chars taken from the response text for a session_summary. */
const MAX_SUMMARY_CHARS = 400;
/** Relevance multiplied by this on every daily sweep cycle. */
const RELEVANCE_DECAY = 0.9;
/** Rows below this relevance threshold are deleted on sweep. */
const RELEVANCE_PRUNE_THRESHOLD = 0.1;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryRow = typeof aiSessionMemoriesTable.$inferSelect;

// ── Fetch ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the top `limit` non-expired memories for a project, sorted by
 * relevance descending.  Gracefully returns [] on any DB error.
 */
export async function fetchSessionMemories(
  projectId: string,
  limit = 20,
): Promise<MemoryRow[]> {
  const now = new Date();
  try {
    return await db
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
      .orderBy(desc(aiSessionMemoriesTable.relevance))
      .limit(limit);
  } catch {
    return [];
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Persist memories extracted from a completed chat turn.
 *
 * Caller should fire-and-forget with `.catch(logger.warn)` — this must never
 * block the HTTP response.
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
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows: InsertAiSessionMemory[] = [];

  // ── file_summary rows ────────────────────────────────────────────────────
  // Keep only strings that look like actual file paths (contain a dot-extension
  // or a path separator) rather than entity names or generic labels.
  const filePaths = toolSources.filter(
    (s) =>
      (s.includes("/") || s.includes("\\")) ||
      /\.[a-zA-Z]{2,6}$/.test(s),
  );
  for (const filePath of filePaths.slice(0, MAX_FILE_MEMORIES)) {
    rows.push({
      id: randomUUID(),
      projectId,
      sessionId,
      memoryType: "file_summary",
      content: "Previously accessed and analyzed in a chat session.",
      sourcePath: filePath,
      relevance: 1.0,
      createdAt: now,
      expiresAt,
    });
  }

  // ── session_summary row ──────────────────────────────────────────────────
  // Strip code blocks (too noisy) and take the first paragraph of the prose.
  const summary = responseText
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`[^`]+`/g, (m) => m) // keep inline code intact
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);

  if (summary.length > 30) {
    rows.push({
      id: randomUUID(),
      projectId,
      sessionId,
      memoryType: "session_summary",
      content: summary,
      sourcePath: null,
      relevance: 0.85,
      createdAt: now,
      expiresAt,
    });
  }

  if (rows.length === 0) return;

  await db.insert(aiSessionMemoriesTable).values(rows);

  console.info(
    JSON.stringify({
      scope: "session-memory",
      code: "MEMORIES_WRITTEN",
      projectId,
      sessionId,
      filePaths: rows.filter((r) => r.memoryType === "file_summary").length,
      hasSummary: rows.some((r) => r.memoryType === "session_summary"),
    }),
  );
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
export function formatMemoriesForPrompt(memories: MemoryRow[]): string | null {
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

  if (summaryMemories.length > 0 && summaryMemories[0]) {
    lines.push(`  ${summaryMemories[0].content.slice(0, 300)}`);
  }

  const payload = [
    "Historical session memory is a navigation hint only; it may be stale and is not current evidence.",
    "Read current source or obtain current telemetry before making a present-tense claim.",
    ...lines,
  ].join("\n");
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
): Promise<void> {
  const memories = await fetchSessionMemories(projectId, 20);
  const formatted = formatMemoriesForPrompt(memories);
  if (formatted) {
    context.sessionMemories = formatted;
  }
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Daily maintenance sweep:
 *   1. Delete expired rows (expiresAt < now)
 *   2. Decay relevance of all live rows by RELEVANCE_DECAY per call
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

    // 2. Decay relevance for rows older than 1 day
    await db
      .update(aiSessionMemoriesTable)
      .set({
        relevance: sql<number>`GREATEST(0.0, ${aiSessionMemoriesTable.relevance} * ${RELEVANCE_DECAY})`,
      })
      .where(
        and(
          lt(aiSessionMemoriesTable.createdAt, oneDayAgo),
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
 * @param intervalMs  How often to run the sweep (default: every 6 hours).
 * @returns           A stop function that cancels the interval.
 */
export function startMemorySweep(
  intervalMs = 6 * 60 * 60 * 1000,
): { stop: () => void } {
  // Run once immediately at startup to clear any backlog from a restart.
  sweepExpiredMemories().catch(() => {});

  const handle = setInterval(() => {
    sweepExpiredMemories().catch(() => {});
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
  };
}
