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
import { z } from "zod";
import { db } from "@workspace/db";
import {
  aiSessionMemoriesTable,
  aiSessionMemoryOutboxTable,
  type InsertAiSessionMemory,
} from "@workspace/db";
import { and, asc, desc, eq, gt, isNull, lte, lt, or, sql } from "drizzle-orm";
import type { ProjectContext } from "./context-builder.js";
import type { ExecutionPlan } from "./model-selection/execution-plan.js";
import { ChatTaskResultSchema } from "./schemas/chat.schema.js";
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
const MAX_SEMANTIC_MEMORIES_PER_TURN = 6;
const MAX_SEMANTIC_CONTENT_CHARS = 800;
const MAX_SEMANTIC_SCOPE_CHARS = 160;
const MAX_SEMANTIC_SOURCE_CHARS = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryRow = typeof aiSessionMemoriesTable.$inferSelect;
type MemoryPromptRow = Pick<
  MemoryRow,
  "id" | "projectId" | "sessionId" | "memoryType" | "content" | "sourcePath" | "relevance" | "createdAt" | "expiresAt"
> & Partial<Pick<
  MemoryRow,
  | "dedupeKey"
  | "lastDecayAt"
  | "semanticKind"
  | "scope"
  | "turnId"
  | "provenance"
  | "sourceReference"
  | "sourceRevision"
  | "confidence"
  | "confirmationStatus"
  | "freshnessStatus"
>>;

export const SemanticMemoryKindSchema = z.enum([
  "decision",
  "constraint",
  "unresolved_question",
  "key_finding",
]);
export type SemanticMemoryKind = z.infer<typeof SemanticMemoryKindSchema>;

export const SemanticMemoryRecordSchema = z.object({
  kind: SemanticMemoryKindSchema,
  content: z.string().trim().min(3).max(MAX_SEMANTIC_CONTENT_CHARS),
  scope: z.string().trim().min(1).max(MAX_SEMANTIC_SCOPE_CHARS),
  provenance: z.enum([
    "explicit_user_decision",
    "explicit_user_statement",
    "accepted_plan",
    "validated_finding",
  ]),
  sourceReference: z.string().trim().min(1).max(MAX_SEMANTIC_SOURCE_CHARS).optional(),
  sourceRevision: z.string().trim().min(1).max(200).optional(),
  confidence: z.number().min(0).max(1),
  confirmationStatus: z.enum([
    "unconfirmed",
    "user_confirmed",
    "server_validated",
  ]),
  freshnessStatus: z.enum(["current_at_write", "stale", "unknown"]),
}).strict();
export type SemanticMemoryRecord = z.infer<typeof SemanticMemoryRecordSchema>;

export type SemanticMemoryExtractionInput = {
  outcome?: string;
  turnIntent?: string;
  memoryMode?: MemoryPolicy["mode"];
  userMessage?: string;
  taskScope?: string;
  projectRevision?: string;
  /** A server-validated typed result, never arbitrary provider response text. */
  taskResult?: unknown;
};

export type MemoryRetrievalOptions = {
  /** The active task scope; project-scoped records always remain eligible. */
  taskScope?: string;
  /** Current project revision used to label source-bound records stale. */
  projectRevision?: string;
};

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
  semanticRecords: SemanticMemoryRecord[];
};

function boundedSemanticText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_SEMANTIC_CONTENT_CHARS);
}

function normalizeSemanticScope(scope: string | undefined): string {
  const value = scope?.trim();
  return value ? `task:${value.slice(0, MAX_SEMANTIC_SCOPE_CHARS - 5)}` : "project";
}

function semanticDedupeKey(projectId: string, record: SemanticMemoryRecord): string {
  const normalized = record.content.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return `${projectId}:semantic:${record.kind}:${record.scope}:${normalized}`;
}

function extractLabeledUserRecords(input: SemanticMemoryExtractionInput): SemanticMemoryRecord[] {
  const message = input.userMessage?.trim();
  if (!message) return [];
  const labels: Array<{ kind: SemanticMemoryKind; pattern: RegExp }> = [
    { kind: "decision", pattern: /^(?:decision|decided|قرار|قررت|قرارنا)\s*:\s*/iu },
    { kind: "constraint", pattern: /^(?:constraint|قيود|قيد)\s*:\s*/iu },
    { kind: "unresolved_question", pattern: /^(?:unresolved question|open question|سؤال غير محسوم|سؤال مفتوح)\s*:\s*/iu },
  ];
  const records: SemanticMemoryRecord[] = [];
  for (const { kind, pattern } of labels) {
    const match = message.match(pattern);
    if (!match) continue;
    const content = boundedSemanticText(message.slice(match[0].length));
    if (content.length < 3) continue;
    records.push({
      kind,
      content,
      scope: normalizeSemanticScope(input.taskScope),
      provenance: kind === "decision" ? "explicit_user_decision" : "explicit_user_statement",
      sourceReference: "user_message",
      ...(input.projectRevision ? { sourceRevision: input.projectRevision } : {}),
      confidence: 1,
      confirmationStatus: "user_confirmed",
      freshnessStatus: input.projectRevision ? "current_at_write" : "unknown",
    });
  }
  return records;
}

function extractValidatedTaskRecords(input: SemanticMemoryExtractionInput): SemanticMemoryRecord[] {
  const parsedResult = ChatTaskResultSchema.safeParse(input.taskResult);
  if (!parsedResult.success) return [];
  const parsed = parsedResult.data as unknown as Record<string, unknown>;
  if (parsed.kind !== "IMPLEMENTATION_PLAN_RESULT" && parsed.kind !== "FINDING_RESULT") {
    return [];
  }

  if (parsed.kind === "IMPLEMENTATION_PLAN_RESULT") {
    const approvalStatus = parsed.approvalStatus;
    const writeAccess = parsed.writeAccess;
    const objective = typeof parsed.objective === "string" ? boundedSemanticText(parsed.objective) : "";
    if (approvalStatus !== "APPROVED" || writeAccess !== "APPROVED_FOR_BUILD" || objective.length < 3) {
      return [];
    }
    return [{
      kind: "decision",
      content: `Approved implementation plan: ${objective}`,
      scope: normalizeSemanticScope(input.taskScope),
      provenance: "accepted_plan",
      sourceReference: "IMPLEMENTATION_PLAN_RESULT",
      ...(input.projectRevision ? { sourceRevision: input.projectRevision } : {}),
      confidence: 0.95,
      confirmationStatus: "server_validated",
      freshnessStatus: input.projectRevision ? "current_at_write" : "unknown",
    }];
  }

  const finding = parsed.finding;
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) return [];
  const findingRecord = finding as Record<string, unknown>;
  const content = typeof findingRecord.finding === "string"
    ? boundedSemanticText(findingRecord.finding)
    : "";
  const severity = findingRecord.severity;
  const evidence = Array.isArray(findingRecord.evidence) ? findingRecord.evidence : [];
  const acceptedEvidence = evidence.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
    && (entry as Record<string, unknown>).evidenceClass === "FINDING_PROVEN"
    && (entry as Record<string, unknown>).citationStatus !== "BLOCKED",
  );
  if (
    content.length < 3
    || severity === "NOT_PROVEN"
    || acceptedEvidence.length === 0
  ) return [];
  const sourceEntry = acceptedEvidence.find((entry) => typeof entry.source === "string");
  const source = typeof sourceEntry?.source === "string" ? sourceEntry.source : undefined;
  return [{
    kind: "key_finding",
    content,
    scope: normalizeSemanticScope(input.taskScope),
    provenance: "validated_finding",
    ...(source ? { sourceReference: source.slice(0, MAX_SEMANTIC_SOURCE_CHARS) } : {}),
    ...(input.projectRevision ? { sourceRevision: input.projectRevision } : {}),
    confidence: 0.9,
    confirmationStatus: "server_validated",
    freshnessStatus: input.projectRevision ? "current_at_write" : "unknown",
  }];
}

/**
 * Extract semantic memory only from explicit user labels or server-verified
 * typed results. In particular, responseText is deliberately not inspected.
 */
export function extractSemanticMemories(
  input: SemanticMemoryExtractionInput,
): SemanticMemoryRecord[] {
  if (
    input.outcome !== "SUCCEEDED"
    || input.memoryMode === "none"
    || input.turnIntent === "FORENSIC_AUDIT"
  ) return [];
  const candidates = [
    ...extractLabeledUserRecords(input),
    ...extractValidatedTaskRecords(input),
  ];
  const deduped = new Map<string, SemanticMemoryRecord>();
  for (const candidate of candidates) {
    const parsed = SemanticMemoryRecordSchema.safeParse(candidate);
    if (parsed.success) deduped.set(
      `${parsed.data.kind}:${parsed.data.scope}:${parsed.data.content.toLocaleLowerCase()}`,
      parsed.data,
    );
  }
  return [...deduped.values()].slice(0, MAX_SEMANTIC_MEMORIES_PER_TURN);
}

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
  for (const record of payload.semanticRecords) {
    rows.push({
      id: randomUUID(),
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      memoryType: record.kind === "key_finding" ? "key_finding" : "entity_fact",
      semanticKind: record.kind,
      scope: record.scope,
      turnId: payload.turnId,
      provenance: record.provenance,
      content: record.content,
      sourcePath: record.kind === "key_finding" && record.sourceReference?.includes("/")
        ? normalizeProjectRelativePath(record.sourceReference)
        : null,
      sourceReference: record.sourceReference ?? null,
      sourceRevision: record.sourceRevision ?? null,
      confidence: record.confidence,
      confirmationStatus: record.confirmationStatus,
      freshnessStatus: record.freshnessStatus,
      dedupeKey: semanticDedupeKey(payload.projectId, record),
      relevance: record.confirmationStatus === "user_confirmed" ? 1 : 0.95,
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
  options?: Readonly<MemoryRetrievalOptions>,
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
    const taskScope = options?.taskScope?.trim();
    const eligible = rows.filter((row) => {
      if (policy?.mode === "summary"
        && row.memoryType !== "session_summary"
        && !row.semanticKind) return false;
      if (!row.semanticKind || !taskScope) return true;
      return row.scope === "project" || row.scope === `task:${taskScope}`;
    });
    const deduped = new Map<string, MemoryRow>();
    for (const row of eligible) {
      const key = row.dedupeKey ?? `${row.memoryType}:${row.sourcePath ?? row.sessionId}`;
      const previous = deduped.get(key);
      if (!previous || row.createdAt > previous.createdAt) deduped.set(key, row);
    }
    const withFreshness = [...deduped.values()].map((row) => {
      const stale = Boolean(
        options?.projectRevision
        && row.semanticKind
        && row.sourceRevision
        && row.sourceRevision !== options.projectRevision,
      );
      return stale ? { ...row, freshnessStatus: "stale" as const } : row;
    });
    const maxCreatedAt = Math.max(
      now.getTime(),
      ...withFreshness.map((row) => row.createdAt.getTime()),
    );
    return withFreshness
      .sort((a, b) => {
        const ageA = Math.max(0, maxCreatedAt - a.createdAt.getTime());
        const ageB = Math.max(0, maxCreatedAt - b.createdAt.getTime());
        const recencyA = 1 / (1 + ageA / (7 * 24 * 60 * 60 * 1000));
        const recencyB = 1 / (1 + ageB / (7 * 24 * 60 * 60 * 1000));
        const scopeA = a.semanticKind && taskScope && a.scope === `task:${taskScope}` ? 0.12 : 0;
        const scopeB = b.semanticKind && taskScope && b.scope === `task:${taskScope}` ? 0.12 : 0;
        const confirmationA = a.confirmationStatus === "user_confirmed" || a.confirmationStatus === "server_validated"
          ? 0.05
          : 0;
        const confirmationB = b.confirmationStatus === "user_confirmed" || b.confirmationStatus === "server_validated"
          ? 0.05
          : 0;
        const freshnessA = a.freshnessStatus === "stale" ? -0.25 : 0;
        const freshnessB = b.freshnessStatus === "stale" ? -0.25 : 0;
        const scoreA = a.relevance * 0.58 + recencyA * 0.25 + scopeA + confirmationA + freshnessA;
        const scoreB = b.relevance * 0.58 + recencyB * 0.25 + scopeB + confirmationB + freshnessB;
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
  options: Readonly<Omit<SemanticMemoryExtractionInput, "outcome"> & { outcome?: string }> = {},
): Promise<void> {
  if (
    options.outcome !== undefined && options.outcome !== "SUCCEEDED"
    || options.memoryMode === "none"
    || options.turnIntent === "FORENSIC_AUDIT"
  ) return;
  const now = new Date();
  const semanticRecords = extractSemanticMemories({
    ...options,
    outcome: options.outcome ?? "SUCCEEDED",
  });
  const payload: MemoryWritePayload = {
    sessionId,
    projectId,
    turnId,
    toolSources: toolSources.filter((value): value is string => typeof value === "string"),
    responseText,
    createdAt: now,
    semanticRecords,
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
    semanticRecords: payload.semanticRecords,
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
        semanticKind: row.semanticKind,
        scope: row.scope,
        turnId: row.turnId,
        provenance: row.provenance,
        sourceReference: row.sourceReference,
        sourceRevision: row.sourceRevision,
        confidence: row.confidence,
        confirmationStatus: row.confirmationStatus,
        freshnessStatus: row.freshnessStatus,
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
      semanticRecords: (() => {
        const parsed = SemanticMemoryRecordSchema.array()
          .max(MAX_SEMANTIC_MEMORIES_PER_TURN)
          .safeParse(entry.semanticRecords ?? []);
        return parsed.success ? parsed.data : [];
      })(),
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

  const semanticMemories = memories.filter((m) => m.semanticKind);
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

  if (semanticMemories.length > 0) {
    lines.push("  Semantic records (historical, untrusted):");
    for (const memory of semanticMemories) {
      const label = memory.semanticKind === "unresolved_question"
        ? "unresolved question"
        : memory.semanticKind;
      const metadata = [
        memory.scope ? `scope=${memory.scope}` : "scope=project",
        memory.confirmationStatus ? `confirmation=${memory.confirmationStatus}` : "confirmation=unknown",
        memory.freshnessStatus ? `freshness=${memory.freshnessStatus}` : "freshness=unknown",
        memory.sourceReference ? `source=${memory.sourceReference}` : "",
      ].filter(Boolean).join(" ");
      lines.push(`  [remembered ${label}] ${memory.content.slice(0, 300)} (${metadata})`);
    }
  }

  for (const memory of memories) {
    if (
      memory.memoryType === "file_summary"
      || memory.memoryType === "session_summary"
      || memory.semanticKind
    ) continue;
    lines.push(`  [${memory.memoryType}] ${memory.content.slice(0, 300)}`);
  }

  const payload = [
    "Historical session memory contains navigation hints and semantic records only; it may be stale and is never current evidence.",
    "Remembered decisions, constraints, unresolved questions, and findings do not authorize approval, repair, or writes.",
    "Re-read current source or obtain current runtime telemetry before making a present-tense claim.",
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
  options?: Readonly<MemoryRetrievalOptions>,
): Promise<void> {
  const mode = plan?.taskProfile.memoryMode ?? "episodic";
  const limit = plan?.memoryDepth ?? 20;
  if (mode === "none" || limit === 0) {
    delete context.sessionMemories;
    return;
  }
  const memories = await fetchSessionMemories(projectId, limit, { mode, limit }, options);
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
