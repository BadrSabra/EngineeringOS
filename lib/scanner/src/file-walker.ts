import { open, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, extname, relative } from "node:path";

/** Maximum bytes to read per file for content analysis (512 KB). */
const MAX_CONTENT_BYTES = 512 * 1024;
/** Maximum aggregate file content retained for one project scan (64 MiB). */
const MAX_TOTAL_CONTENT_BYTES = 64 * 1024 * 1024;

/**
 * Soft cap on the number of source files collected in a single walk.
 * When this limit is reached the walk stops collecting new files and returns
 * immediately with `truncated: true` rather than throwing — callers receive
 * a partial-but-valid result they can persist and surface to the user rather
 * than a hard failure.
 *
 * PR-04: changed from throw to soft-truncate so large repos produce a usable
 * (if incomplete) scan result instead of a failed job.
 */
const MAX_FILES = 5_000;

/** Maximum directory depth to recurse into. */
const MAX_DEPTH = 12;

/** Directories always excluded from scanning. */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".next",
  ".nuxt",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "target",
  "vendor",
  ".tsbuildinfo",
]);

/** Source file extensions we care about. */
const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".sh": "shell",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".sql": "sql",
  ".md": "markdown",
};

export interface ScannedFile {
  /** Path relative to the project root. */
  path: string;
  /** Absolute filesystem path. */
  absPath: string;
  language: string;
  /** File size in bytes. */
  size: number;
  /** Line count (accurate if content is loaded). */
  lines: number;
  /** Full content (empty string if file exceeded MAX_CONTENT_BYTES). */
  content: string;
  /** True if content was truncated due to file size. */
  oversized: boolean;
}

export interface RevisionManifestFile {
  path: string;
  size: number;
  contentHash: string;
  oversized: boolean;
}

/** Server-owned snapshot identity shared by scan-derived artifacts. */
export interface RevisionManifest {
  revision: string;
  sourceRoot: string;
  files: RevisionManifestFile[];
  completeness: "COMPLETE" | "PARTIAL";
}

export interface WalkResult {
  files: ScannedFile[];
  rootPath: string;
  /** Whether rootPath actually existed on disk. */
  rootExists: boolean;
  totalFiles: number;
  sourceFiles: number;
  /**
    * True when the walk stopped early due to a file-count, depth, or aggregate
    * content limit. Callers must treat the result as incomplete.
   */
  truncated: boolean;
  /**
    * PR-04: Human-readable reason for truncation, when `truncated` is true.
    * Machine-parseable prefix before the colon: "file_limit", "depth_limit",
    * or "content_limit".
   */
  truncationReason?: string;
  /**
   * PR-04: Approximate number of source files skipped due to the cap.
   * Only meaningful when `truncated` is true. -1 means the count is unknown
   * (scan was aborted before all skipped files were counted).
   */
  filesSkipped: number;
  /** Stable digest of the exact file inventory and readable contents. */
  revision: string;
  /** Exact file inventory used to derive scanner, graph, and metric results. */
  revisionManifest: RevisionManifest;
}

/** Mutable walk state — shared across the recursive walkDir calls. */
interface WalkState {
  aborted: boolean;
  contentBytes: number;
  truncationReason?: string;
}

async function readBoundedContent(
  fileHandle: Awaited<ReturnType<typeof open>>,
  expectedSize: number,
  signal?: AbortSignal,
): Promise<{ content: string; size: number; oversized: boolean }> {
  const chunks: Buffer[] = [];
  let bytesReadTotal = 0;

  while (bytesReadTotal <= MAX_CONTENT_BYTES) {
    signal?.throwIfAborted();
    const remainingLimit = MAX_CONTENT_BYTES + 1 - bytesReadTotal;
    const remainingExpected = expectedSize - bytesReadTotal;
    const length = Math.min(
      64 * 1024,
      remainingLimit,
      Math.max(1, remainingExpected >= 0 ? remainingExpected + 1 : 64 * 1024),
    );
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await fileHandle.read(buffer, 0, length, bytesReadTotal);
    signal?.throwIfAborted();
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    bytesReadTotal += bytesRead;
  }

  if (bytesReadTotal > MAX_CONTENT_BYTES) {
    return {
      content: "",
      size: Math.max(expectedSize, bytesReadTotal),
      oversized: true,
    };
  }

  return {
    content: Buffer.concat(chunks, bytesReadTotal).toString("utf8"),
    size: expectedSize,
    oversized: false,
  };
}

async function walkDir(
  dir: string,
  rootPath: string,
  files: ScannedFile[],
  state: WalkState,
  depth = 0,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  // PR-04: depth cap — record truncation but don't abort the whole walk (other
  // branches at this level may still be within the depth limit).
  if (depth > MAX_DEPTH) {
    if (!state.truncationReason) {
      state.truncationReason = `depth_limit:${MAX_DEPTH}`;
      state.aborted = true;
    }
    return;
  }

  // PR-04: file-count cap — soft abort: stop collecting, mark truncated.
  if (state.aborted || files.length >= MAX_FILES) {
    state.aborted = true;
    if (!state.truncationReason) {
      state.truncationReason = `file_limit:${MAX_FILES}`;
    }
    return;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (signal?.aborted) throw error;
    // A failure at the canonical root is not a partial branch: it means the
    // project disappeared or became inaccessible after the initial stat.
    // Preserve that signal so scan-runner can fail closed instead of
    // publishing an empty successful inventory.
    if (depth === 0) {
      throw new Error(`Project root became inaccessible during walk: ${rootPath}`, {
        cause: error,
      });
    }
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      signal?.throwIfAborted();
      if (state.aborted) return; // respect abort in concurrent branches

      if (entry.isDirectory()) {
        // Skip dot-directories but allow .github (CI/CD workflows live there).
        if (IGNORE_DIRS.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".github")) return;
        await walkDir(join(dir, entry.name), rootPath, files, state, depth + 1, signal);
      } else if (entry.isFile()) {
        if (state.aborted || files.length >= MAX_FILES) {
          state.aborted = true;
          if (!state.truncationReason) state.truncationReason = `file_limit:${MAX_FILES}`;
          return;
        }

        const ext = extname(entry.name).toLowerCase();
        // Go module metadata is required by graph extraction to resolve
        // internal import paths, but it has no extension in the language map.
        const language = entry.name === "go.mod" ? "go-module" : LANGUAGE_MAP[ext];
        if (!language) return;

        const absPath = join(dir, entry.name);
        const relPath = relative(rootPath, absPath);

        let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
        try {
          fileHandle = await open(absPath, "r");
          const fileStat = await fileHandle.stat();
          signal?.throwIfAborted();
          if (!fileStat.isFile()) return;

          let size = fileStat.size;
          let content = "";
          let oversized = false;

          if (size <= MAX_CONTENT_BYTES) {
            if (state.contentBytes + size > MAX_TOTAL_CONTENT_BYTES) {
              state.aborted = true;
              state.truncationReason ??= `content_limit:${MAX_TOTAL_CONTENT_BYTES}`;
              return;
            }
            state.contentBytes += size;
            try {
              const bounded = await readBoundedContent(fileHandle, size, signal);
              content = bounded.content;
              size = bounded.size;
              oversized = bounded.oversized;
              if (oversized) state.contentBytes -= fileStat.size;
            } catch (error) {
              state.contentBytes -= fileStat.size;
              if (signal?.aborted) throw error;
              content = "";
            }
          } else {
            oversized = true;
          }

          const lines = content ? content.split("\n").length : 0;

          files.push({ path: relPath, absPath, language, size, lines, content, oversized });
        } catch (error) {
          if (signal?.aborted) throw error;
        } finally {
          await fileHandle?.close().catch(() => undefined);
        }
      }
    }),
  );
}

/**
 * Walk a project directory and collect all source files.
 *
 * Throws when `rootPath` does not exist or is not a directory — a silent
 * fallback would cause scanners to walk the wrong directory and report
 * plausible-looking but wrong results.
 *
 * PR-04: no longer throws on file-count cap. Instead returns `truncated: true`
 * with the files collected so far, so callers can persist a partial result
 * and surface the truncation to the user.
 */
export async function walkProject(rootPath: string, signal?: AbortSignal): Promise<WalkResult> {
  signal?.throwIfAborted();
  try {
    const s = await stat(rootPath);
    signal?.throwIfAborted();
    if (!s.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${rootPath}`);
    }
  } catch (statErr) {
    if (signal?.aborted) throw statErr;
    if (statErr instanceof Error && statErr.message.startsWith("Path exists but")) {
      throw statErr;
    }
    throw new Error(`Project root does not exist or is inaccessible: ${rootPath}`);
  }

  const files: ScannedFile[] = [];
  const state: WalkState = { aborted: false, contentBytes: 0 };

  await walkDir(rootPath, rootPath, files, state, 0, signal);
  signal?.throwIfAborted();

  // GAP-4 fix: sort by relative path for deterministic output.
  // Promise.all over readdir entries produces OS-dependent ordering; sorting
  // here ensures two scans of identical code yield identical entity sequences,
  // eliminating spurious diff noise in incremental comparisons.
  files.sort((a, b) => a.path.localeCompare(b.path));

  const sourceFiles = files.filter(
    (f) =>
      f.language !== "markdown" &&
      f.language !== "json" &&
      f.language !== "yaml" &&
      f.language !== "toml" &&
      f.language !== "go-module",
  ).length;
  const revisionHash = createHash("sha256");
  const manifestFiles: RevisionManifestFile[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const contentHash = createHash("sha256")
      .update(file.oversized ? `oversized:${file.size}` : file.content)
      .digest("hex");
    manifestFiles.push({
      path: file.path,
      size: file.size,
      contentHash,
      oversized: file.oversized,
    });
    revisionHash.update(file.path);
    revisionHash.update("\0");
    revisionHash.update(String(file.size));
    revisionHash.update("\0");
    revisionHash.update(file.oversized ? "oversized" : file.content);
    revisionHash.update("\n");
  }

  const revision = revisionHash.digest("hex");
  signal?.throwIfAborted();
  return {
    files,
    rootPath,
    rootExists: true,
    totalFiles: files.length,
    sourceFiles,
    truncated: state.aborted,
    truncationReason: state.truncationReason,
    // When aborted by a cap, skipped count is unknown (Promise.all branches
    // were concurrent); signal with -1.
    filesSkipped: state.aborted ? -1 : 0,
    revision,
    revisionManifest: {
      revision,
      sourceRoot: rootPath,
      files: manifestFiles,
      completeness: state.aborted ? "PARTIAL" : "COMPLETE",
    },
  };
}
