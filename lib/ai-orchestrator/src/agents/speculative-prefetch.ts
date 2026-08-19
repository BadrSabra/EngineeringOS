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

 import { promises as fs } from "node:fs";
 import path from "node:path";
 import { executeFileTool } from "../tools/file-tools.js";
import type { PendingChange } from "../schemas/chat.schema.js";
import type { RawMessage } from "../groq-client.js";
import { isForensicTestSourcePath } from "../forensic-source-policy.js";
import type { ForensicRootCoverage } from "../forensic-output-guard.js";

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
/**
 * Bounded deterministic collection budget for explicitly scoped forensic audits.
 *
 * The cap must clear the largest real production source tree a broad multi-root
 * audit can scope (measured: lib/ai-orchestrator is 84 files + lib/knowledge-engine
 * 6, so a two-root audit needs ~90 reads). A cap too small makes the last root
 * PARTIAL/BUDGET_EXHAUSTED, and sourceCoverage completeness is a hard gate that
 * falsifies the whole verdict. 128 gives headroom for a largest single root plus
 * a sibling while keeping collection bounded.
 */
export const MAX_FORENSIC_DISCOVERY_FILES = 256;
const FORENSIC_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  "__pycache__",
  ".venv",
  "build",
  "coverage",
  // Generated benchmark/output trees are useful only when the user names
  // that tree explicitly. Skipping them by default keeps a source-root audit
  // focused on implementation and configuration evidence.
  "benchmark-results",
  "generated",
  "__generated__",
  "generated-artifacts",
]);

const GENERATED_SOURCE_FILENAME_RE =
  /(?:^|[._-])(?:generated|gen)(?:[._-]|$)/i;

/**
 * Keep every prefetch source and cache key in the same root-relative form.
 * Planner/memory results can contain the same file as `./src/file.ts`,
 * `src\file.ts`, and `src/file.ts`; those must be one read, not three.
 */
function normalizePrefetchPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function uniquePrefetchPaths(
  files: Iterable<string>,
  excludeFiles: Iterable<string> = [],
): string[] {
  const excluded = new Set(
    [...excludeFiles].map(normalizePrefetchPath),
  );
  const unique = new Set<string>();
  for (const file of files) {
    const normalized = normalizePrefetchPath(file);
    if (
      normalized.length >= 4 &&
      !excluded.has(normalized) &&
      !unique.has(normalized)
    ) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

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

export interface ForensicDiscoveryResult extends PrefetchResult {
  /** Ordered roots whose discovery/read phase completed before the budget ended. */
  completedRootCount: number;
  /** Files found during discovery, including files whose read failed. */
  discoveredFiles: string[];
  /** Completeness verdict for every requested root. */
  rootCoverage: ForensicRootCoverage[];
  /** True when the bounded collection budget prevented full discovery. */
  budgetExhausted: boolean;
}

async function readPrefetchFile(
  filePath: string,
  rootPath: string,
  pendingChanges: PendingChange[],
  complete: boolean,
): Promise<string | null> {
  try {
    const raw = await executeFileTool(
      "read_file",
      complete ? { path: filePath, complete: "true" } : { path: filePath },
      rootPath,
      pendingChanges,
    );
    if (/^Error\b/i.test(raw.trim()) || raw.toLowerCase().startsWith("file not found")) {
      return null;
    }
    if (!complete) return raw;
    return raw;
  } catch {
    return null;
  }
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
  complete?: boolean;
  maxFiles?: number;
  excludeFiles?: Iterable<string>;
  includeTestSources?: boolean;
}): Promise<PrefetchResult> {
  const {
    message,
    rootPath,
    pendingChanges,
    toolCacheKeyFn,
    profileDepth,
    complete = false,
    maxFiles = MAX_PREFETCH_FILES,
    excludeFiles,
    includeTestSources = false,
  } = opts;

  // Lite turns don't benefit from speculative prefetch — skip entirely to keep
  // the context window lean.
  if (profileDepth === "chat-lite") {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  const mentionedFiles = uniquePrefetchPaths(
    extractMentionedFiles(message),
    excludeFiles,
  )
    .filter((file) => includeTestSources || !isForensicTestSourcePath(file))
    .slice(0, Math.max(0, maxFiles));
  if (mentionedFiles.length === 0) {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  // Attempt all reads in parallel — errors are caught per-file
  const readResults = await Promise.all(
    mentionedFiles.map(async (filePath) => {
      const raw = await readPrefetchFile(filePath, rootPath, pendingChanges, complete);
      if (raw === null) return { filePath, content: null };
      try {
        // Truncate to budget
        const content =
          !complete && raw.length > MAX_PREFETCH_BYTES
            ? raw.slice(0, MAX_PREFETCH_BYTES) +
              "\n… [prefetch output truncated — this is a display limit, not evidence that the file is incomplete. Use targeted search_code for exact evidence]"
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
  //
  // IMPORTANT: IDs must be unique across turns in the same conversation.
  // Static IDs like "prefetch_0" appear in conversation history and cause
  // Cohere (and potentially others) to reject subsequent requests with
  // "cannot have duplicate tool ids". Use a per-request nonce to guarantee
  // uniqueness regardless of how many times prefetch runs in a session.
  const nonce = Math.random().toString(36).slice(2, 8);
  const syntheticToolCalls = hits.map((r, idx) => ({
    id: `prefetch_${nonce}_${idx}`,
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
      tool_call_id: `prefetch_${nonce}_${idx}`,
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
  complete?: boolean;
  maxFiles?: number;
  excludeFiles?: Iterable<string>;
  includeTestSources?: boolean;
}): Promise<PrefetchResult> {
  const {
    files,
    rootPath,
    pendingChanges,
    toolCacheKeyFn,
    complete = false,
    maxFiles = MAX_PLAN_PREFETCH_FILES,
    excludeFiles,
    includeTestSources = false,
  } = opts;

  // Filter to recognized extensions and cap the list
  const candidates = uniquePrefetchPaths(files, excludeFiles)
    .filter((f) => {
      const ext = f.split(".").pop()?.toLowerCase() ?? "";
      return SOURCE_EXTENSIONS.has(ext);
    })
    .filter((f) => includeTestSources || !isForensicTestSourcePath(f))
    .slice(0, Math.max(0, maxFiles));

  if (candidates.length === 0) {
    return { injectedMessages: [], sources: [], cacheEntries: [] };
  }

  const readResults = await Promise.all(
    candidates.map(async (filePath) => {
      const raw = await readPrefetchFile(filePath, rootPath, pendingChanges, complete);
      if (raw === null) return { filePath, content: null };
      try {
        const content =
          !complete && raw.length > MAX_PREFETCH_BYTES
            ? raw.slice(0, MAX_PREFETCH_BYTES) +
              "\n… [prefetch output truncated — this is a display limit, not evidence that the file is incomplete. Use targeted search_code for exact evidence]"
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

  // Per-request nonce prevents duplicate tool_call IDs across turns in the
  // same conversation (same root cause as speculative-prefetch above).
  const planNonce = Math.random().toString(36).slice(2, 8);
  const syntheticToolCalls = hits.map((r, idx) => ({
    id: `plan_prefetch_${planNonce}_${idx}`,
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
      tool_call_id: `plan_prefetch_${planNonce}_${idx}`,
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

async function discoverSourceFiles(
  rootPath: string,
  requestedRoot: string,
  maxFiles: number,
  includeTestSources: boolean,
): Promise<{ files: string[]; hitLimit: boolean }> {
  if (maxFiles <= 0) return { files: [], hitLimit: true };

  const projectRoot = await fs.realpath(rootPath);
  const normalizedRoot = requestedRoot
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");
  const absoluteRoot = path.resolve(projectRoot, normalizedRoot || ".");
  const relativeRoot = path.relative(projectRoot, absoluteRoot);
  if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
    return { files: [], hitLimit: false };
  }

  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= maxFiles) return;
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => !FORENSIC_SKIP_DIRS.has(entry.name))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      // Symlink traversal is deliberately excluded. executeFileTool performs
      // the final realpath containment check, but discovery must not expand a
      // link outside the requested project tree.
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!SOURCE_EXTENSIONS.has(extension)) continue;
      // A directly requested generated file still goes through the eager
      // single-file read path. This filter applies only to broad root
      // discovery, where generated output is not source-of-truth evidence.
      if (GENERATED_SOURCE_FILENAME_RE.test(entry.name)) continue;
      const relative = path.relative(projectRoot, absolute).split(path.sep).join("/");
      if (!includeTestSources && isForensicTestSourcePath(relative)) continue;
      files.push(relative);
    }
  };

  try {
    const stat = await fs.stat(absoluteRoot);
    if (!stat.isDirectory()) return { files: [], hitLimit: false };
    await visit(absoluteRoot);
  } catch {
    return { files: [], hitLimit: false };
  }
  return { files, hitLimit: files.length >= maxFiles };
}

/**
 * Deterministically discover and read every bounded source file in explicitly
 * scoped forensic roots. Roots are processed sequentially; the next root is
 * not discovered until the previous root's candidate reads have completed.
 */
export async function prefetchForensicRoots(opts: {
  roots: string[];
  rootPath: string;
  pendingChanges: PendingChange[];
  toolCacheKeyFn: (name: string, args: Record<string, string>) => string;
  maxFiles?: number;
  excludeFiles?: Iterable<string>;
  includeTestSources?: boolean;
}): Promise<ForensicDiscoveryResult> {
  const {
    roots,
    rootPath,
    pendingChanges,
    toolCacheKeyFn,
    maxFiles = MAX_FORENSIC_DISCOVERY_FILES,
    excludeFiles,
    includeTestSources = false,
  } = opts;
  const excluded = new Set([...excludeFiles ?? []].map(normalizePrefetchPath));
  const allInjectedMessages: RawMessage[] = [];
  const allSources: string[] = [];
  const allCacheEntries: Array<{ key: string; content: string }> = [];
  const discoveredFiles: string[] = [];
  const rootCoverage: ForensicRootCoverage[] = [];
  let remaining = Math.max(0, Math.min(maxFiles, MAX_FORENSIC_DISCOVERY_FILES));
  let completedRootCount = 0;
  let budgetExhausted = false;

  for (const root of roots) {
    if (remaining <= 0) {
      budgetExhausted = true;
      rootCoverage.push({
        root,
        discoveredFiles: 0,
        readFiles: 0,
        unreadFiles: 0,
        status: "BUDGET_EXHAUSTED",
      });
      continue;
    }
    // Ask for one sentinel file beyond the remaining budget so an exact-fit
    // root is not incorrectly marked partial.
    const discovery = await discoverSourceFiles(
      rootPath,
      root,
      remaining + 1,
      includeTestSources,
    );
    const candidates = discovery.files
      .filter((file) => !excluded.has(normalizePrefetchPath(file)));
    discoveredFiles.push(...candidates);
    const rootBudgetExhausted = discovery.hitLimit;
    if (candidates.length > 0) {
      const result = await prefetchFileList({
        files: candidates,
        rootPath,
        pendingChanges,
        toolCacheKeyFn,
        complete: true,
        maxFiles: remaining,
        excludeFiles: excluded,
        includeTestSources,
      });
      allInjectedMessages.push(...result.injectedMessages);
      allSources.push(...result.sources);
      allCacheEntries.push(...result.cacheEntries);
      for (const source of result.sources) excluded.add(normalizePrefetchPath(source));
      remaining -= result.sources.length;
      const unreadFiles = candidates.length - result.sources.length;
      rootCoverage.push({
        root,
        discoveredFiles: candidates.length,
        readFiles: result.sources.length,
        unreadFiles,
        status:
          unreadFiles > 0 || rootBudgetExhausted
            ? rootBudgetExhausted && unreadFiles === 0
              ? "BUDGET_EXHAUSTED"
              : "PARTIAL"
            : "COMPLETE",
      });
      if (rootBudgetExhausted) budgetExhausted = true;
    } else {
      rootCoverage.push({
        root,
        discoveredFiles: 0,
        readFiles: 0,
        unreadFiles: 0,
        status: rootBudgetExhausted ? "BUDGET_EXHAUSTED" : "EMPTY",
      });
      if (rootBudgetExhausted) budgetExhausted = true;
    }
    completedRootCount++;
  }

  console.info(
    JSON.stringify({
      scope: "forensic-discovery",
      code: "FORENSIC_ROOT_DISCOVERY_COMPLETE",
      roots,
      completedRootCount,
      discoveredFiles,
      readFiles: allSources,
      rootCoverage,
      budgetExhausted,
    }),
  );

  return {
    injectedMessages: allInjectedMessages,
    sources: allSources,
    cacheEntries: allCacheEntries,
    completedRootCount,
    discoveredFiles,
    rootCoverage,
    budgetExhausted,
  };
}
