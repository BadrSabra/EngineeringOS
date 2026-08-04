/**
 * Speculative Pre-fetch
 *
 * Analyzes the user's query before the main tool loop starts and pre-reads
 * files that are explicitly mentioned by name. This eliminates the most
 * common first round-trip:
 *
 *   Without pre-fetch:
 *     user → "ما مشكلة auth.ts؟" → model calls read_file(auth.ts) → reads content → answers
 *     (2 API calls, extra latency)
 *
 *   With pre-fetch:
 *     query parsed locally → auth.ts pre-loaded → model gets content immediately → answers
 *     (1 API call)
 *
 * Design constraints:
 *   - At most MAX_PREFETCH_FILES per request (keeps context lean)
 *   - Only attempts filenames with a recognized source extension
 *   - Silent on read errors — the real tool loop covers any misses
 *   - Returns synthetic assistant+tool messages so the model sees pre-fetched
 *     content through the standard tool protocol (not raw injected text)
 *   - Cache entries are returned so the tool loop dedup cache is seeded and
 *     the model never wastes a real tool call re-reading the same file
 */

import { executeFileTool } from "../tools/file-tools.js";
import type { PendingChange } from "../schemas/chat.schema.js";
import type { RawMessage } from "../groq-client.js";

// Recognized source extensions worth pre-fetching
const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "java", "kt", "rb",
  "json", "yaml", "yml", "toml",
  "md", "mdx", "sql", "sh",
]);

/** Match filenames with extensions in various quote/context positions */
const FILE_MENTION_RE = /(?:[`'"(]|\s|^)([\w\-./]+\.([a-zA-Z]{2,5}))(?:[`'")\s,]|$)/g;

const MAX_PREFETCH_FILES = 3;
/** Max files for plan-driven prefetch (higher cap than message-mention prefetch) */
const MAX_PLAN_PREFETCH_FILES = 8;
/** Per-file byte cap — enough to answer most questions without bloating the prompt */
const MAX_PREFETCH_BYTES = 6_000;

// ── Public types ──────────────────────────────────────────────────────────────

export interface PrefetchResult {
  /**
   * Synthetic assistant → tool message pairs to inject into the conversation
   * before the main tool loop. The model sees these as if it already called
   * read_file for each file.
   */
  injectedMessages: RawMessage[];
  /** Ground-truth sources for files that were successfully pre-fetched */
  sources: string[];
  /**
   * key → content pairs to seed the tool call deduplication cache.
   * Prevents the model from wasting real tool calls re-reading these files.
   */
  cacheEntries: Array<{ key: string; content: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract file paths/names referenced in the user's message.
 * Returns at most MAX_PREFETCH_FILES unique paths with recognized extensions.
 */
export function extractMentionedFiles(message: string): string[] {
  const found = new Set<string>();
  FILE_MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_MENTION_RE.exec(message)) !== null) {
    const filePath = match[1];
    const ext = match[2]?.toLowerCase();
    if (ext && SOURCE_EXTENSIONS.has(ext) && filePath.length >= 4) {
      found.add(filePath);
    }
    if (found.size >= MAX_PREFETCH_FILES) break;
  }
  return [...found];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Pre-fetch files mentioned in the message before the tool loop.
 *
 * @param opts.message        The user's raw message
 * @param opts.rootPath       Absolute path to the project root
 * @param opts.pendingChanges Accumulated pending changes (passed through to executeFileTool)
 * @param opts.toolCacheKeyFn The same key function used by the tool loop cache
 * @param opts.profileDepth   Optional context profile — "chat-lite" skips prefetch entirely
 */
export async function speculativePrefetch(opts: {
  message: string;
  rootPath: string;
  pendingChanges: PendingChange[];
  toolCacheKeyFn: (name: string, args: Record<string, string>) => string;
  profileDepth?: "chat-lite" | "chat-normal" | "chat-deep" | "chat";
}): Promise<PrefetchResult> {
  const { message, rootPath, pendingChanges, toolCacheKeyFn, profileDepth } = opts;

  // Lite turns don't benefit from speculative prefetch — skip entirely to keep
  // the context window lean.
  if (profileDepth === "chat-lite") {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  const mentionedFiles = extractMentionedFiles(message);
  if (mentionedFiles.length === 0) {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  // Attempt all reads in parallel — errors are caught per-file
  const readResults = await Promise.all(
    mentionedFiles.map(async (filePath) => {
      try {
        const raw = await executeFileTool("read_file", { path: filePath }, rootPath, pendingChanges);
        // Treat error responses as misses
        if (raw.startsWith("Error:") || raw.toLowerCase().startsWith("file not found")) {
          return { filePath, content: null };
        }
        // Truncate to budget
        const content =
          raw.length > MAX_PREFETCH_BYTES
            ? raw.slice(0, MAX_PREFETCH_BYTES) +
              "\n… [truncated — call read_file for the complete content]"
            : raw;
        return { filePath, content };
      } catch {
        return { filePath, content: null };
      }
    }),
  );

  const hits = readResults.filter((r): r is { filePath: string; content: string } => r.content !== null);
  if (hits.length === 0) {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  // Build synthetic tool exchange: one assistant message with all tool_calls,
  // followed by one tool message per successful read.
  const syntheticToolCalls = hits.map((r, idx) => ({
    id: `prefetch_${idx}`,
    type: "function" as const,
    function: {
      name: "read_file",
      arguments: JSON.stringify({ path: r.filePath }),
    },
  }));

  const injectedMessages: RawMessage[] = [
    // OpenAI spec: content is null when tool_calls is set
    {
      role: "assistant",
      content: null as unknown as string,
      tool_calls: syntheticToolCalls,
    },
    ...hits.map((r, idx) => ({
      role: "tool" as const,
      tool_call_id: `prefetch_${idx}`,
      content: r.content,
    })),
  ];

  const sources = hits.map((r) => r.filePath);
  const cacheEntries = hits.map((r) => ({
    key: toolCacheKeyFn("read_file", { path: r.filePath }),
    content: r.content,
  }));

  console.info(
    JSON.stringify({
      scope: "speculative-prefetch",
      code: "PREFETCH_COMPLETE",
      files: sources,
      bytesLoaded: hits.reduce((sum, r) => sum + r.content.length, 0),
    }),
  );

  return { injectedMessages, sources, cacheEntries };
}

// ── Plan-driven prefetch ──────────────────────────────────────────────────────

/**
 * Pre-fetch an explicit list of files identified by the query planner.
 *
 * Unlike speculativePrefetch (which extracts file names from the message text),
 * this function accepts a pre-resolved file list from QueryPlan.targetFiles and
 * reads up to MAX_PLAN_PREFETCH_FILES of them in parallel.
 *
 * The result uses the same synthetic assistant/tool message protocol as
 * speculativePrefetch so the tool loop dedup cache is seeded identically.
 */
export async function prefetchFileList(opts: {
  files: string[];
  rootPath: string;
  pendingChanges: PendingChange[];
  toolCacheKeyFn: (name: string, args: Record<string, string>) => string;
}): Promise<PrefetchResult> {
  const { files, rootPath, pendingChanges, toolCacheKeyFn } = opts;

  // Filter to recognized extensions and cap the list
  const candidates = files
    .filter((f) => {
      const ext = f.split(".").pop()?.toLowerCase() ?? "";
      return SOURCE_EXTENSIONS.has(ext) && f.length >= 4;
    })
    .slice(0, MAX_PLAN_PREFETCH_FILES);

  if (candidates.length === 0) {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  const readResults = await Promise.all(
    candidates.map(async (filePath) => {
      try {
        const raw = await executeFileTool("read_file", { path: filePath }, rootPath, pendingChanges);
        if (raw.startsWith("Error:") || raw.toLowerCase().startsWith("file not found")) {
          return { filePath, content: null };
        }
        const content =
          raw.length > MAX_PREFETCH_BYTES
            ? raw.slice(0, MAX_PREFETCH_BYTES) + "\n… [truncated — call read_file for the complete content]"
            : raw;
        return { filePath, content };
      } catch {
        return { filePath, content: null };
      }
    }),
  );

  const hits = readResults.filter(
    (r): r is { filePath: string; content: string } => r.content !== null,
  );
  if (hits.length === 0) {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  const syntheticToolCalls = hits.map((r, idx) => ({
    id: `plan_prefetch_${idx}`,
    type: "function" as const,
    function: { name: "read_file", arguments: JSON.stringify({ path: r.filePath }) },
  }));

  const injectedMessages: RawMessage[] = [
    {
      role: "assistant",
      content: null as unknown as string,
      tool_calls: syntheticToolCalls,
    },
    ...hits.map((r, idx) => ({
      role: "tool" as const,
      tool_call_id: `plan_prefetch_${idx}`,
      content: r.content,
    })),
  ];

  const sources = hits.map((r) => r.filePath);
  const cacheEntries = hits.map((r) => ({
    key: toolCacheKeyFn("read_file", { path: r.filePath }),
    content: r.content,
  }));

  console.info(
    JSON.stringify({
      scope: "plan-prefetch",
      code: "PLAN_PREFETCH_COMPLETE",
      files: sources,
      bytesLoaded: hits.reduce((sum, r) => sum + r.content.length, 0),
    }),
  );

  return { injectedMessages, sources, cacheEntries };
}
