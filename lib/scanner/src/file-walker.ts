import { stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Dir } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";
import {
  openProjectChildDirectory,
  openProjectChildFile,
  openProjectRoot,
  openProjectDirectoryCursor,
} from "./safe-path-open.js";

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
export const MAX_FILES = 5_000;
/** Bound simultaneous file descriptors and content reads. */
export const MAX_CONCURRENT_FILE_READS = 16;

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
  filesReserved: number;
  truncationReason?: string;
}

async function readBoundedContent(
  fileHandle: FileHandle,
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

async function scanFileEntry(
  parent: FileHandle,
  name: string,
  rootPath: string,
  relativeDirectory: string,
  language: string,
  files: ScannedFile[],
  state: WalkState,
  signal?: AbortSignal,
): Promise<void> {
  let fileHandle: FileHandle | undefined;
  try {
    signal?.throwIfAborted();
    fileHandle = await openProjectChildFile(parent, name, rootPath);
    const fileStat = await fileHandle.stat();
    signal?.throwIfAborted();

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

    const relPath = relativeDirectory ? join(relativeDirectory, name) : name;
    const absPath = join(rootPath, relPath);
    const lines = content ? content.split("\n").length : 0;
    files.push({ path: relPath, absPath, language, size, lines, content, oversized });
  } catch (error) {
    if (signal?.aborted) throw error;
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}

async function walkDir(
  directory: FileHandle,
  relativeDirectory: string,
  rootPath: string,
  files: ScannedFile[],
  state: WalkState,
  depth = 0,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (depth > MAX_DEPTH) {
    state.truncationReason ??= `depth_limit:${MAX_DEPTH}`;
    state.aborted = true;
    return;
  }
  if (state.aborted) return;

  let entries: Dir;
  try {
    // Directory traversal is deliberately sequential and streamed. This
    // bounds active directory reads and avoids materializing huge entry lists.
    entries = await openProjectDirectoryCursor(directory, rootPath);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (depth === 0) {
      throw new Error(`Project root became inaccessible during walk: ${rootPath}`, {
        cause: error,
      });
    }
    return;
  }

  const pendingFiles: Array<Promise<void>> = [];
  const flushPendingFiles = async () => {
    if (pendingFiles.length === 0) return;
    await Promise.all(pendingFiles.splice(0, pendingFiles.length));
  };

  try {
    while (true) {
      signal?.throwIfAborted();
      if (state.aborted) break;
      const entry = await entries.read();
      if (!entry) break;

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".github")) {
          continue;
        }
        await flushPendingFiles();
        if (state.aborted) break;
        let child: FileHandle | undefined;
        try {
          child = await openProjectChildDirectory(directory, entry.name, rootPath);
          const childPath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
          await walkDir(child, childPath, rootPath, files, state, depth + 1, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
        } finally {
          await child?.close().catch(() => undefined);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      // Go module metadata is required by graph extraction to resolve internal
      // import paths, but it has no extension in the language map.
      const language = entry.name === "go.mod" ? "go-module" : LANGUAGE_MAP[ext];
      if (!language) continue;

      if (state.filesReserved >= MAX_FILES) {
        state.aborted = true;
        state.truncationReason ??= `file_limit:${MAX_FILES}`;
        break;
      }
      state.filesReserved += 1;
      pendingFiles.push(
        scanFileEntry(
          directory,
          entry.name,
          rootPath,
          relativeDirectory,
          language,
          files,
          state,
          signal,
        ),
      );

      // Flush bounded batches before continuing. Directory descent first flushes
      // the batch, so the file-read concurrency cap is global across the walk.
      if (pendingFiles.length >= MAX_CONCURRENT_FILE_READS) {
        await flushPendingFiles();
      }
    }
    await flushPendingFiles();
  } catch (error) {
    await flushPendingFiles();
    if (signal?.aborted) throw error;
    if (depth === 0) {
      throw new Error(`Project root became inaccessible during walk: ${rootPath}`, {
        cause: error,
      });
    }
  } finally {
    await entries.close().catch(() => undefined);
  }
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
  let initialRootStat;
  try {
    initialRootStat = await stat(rootPath);
    signal?.throwIfAborted();
    if (!initialRootStat.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${rootPath}`);
    }
  } catch (statErr) {
    if (signal?.aborted) throw statErr;
    if (statErr instanceof Error && statErr.message.startsWith("Path exists but")) {
      throw statErr;
    }
    throw new Error(`Project root does not exist or is inaccessible: ${rootPath}`);
  }

  let openedRoot;
  try {
    openedRoot = await openProjectRoot(rootPath);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Project root is unsafe or inaccessible: ${rootPath}`, {
      cause: error,
    });
  }
  const { handle: rootHandle, canonicalPath: canonicalRootPath } = openedRoot;
  try {
    const openedRootStat = await rootHandle.stat();
    if (
      openedRootStat.dev !== initialRootStat.dev ||
      openedRootStat.ino !== initialRootStat.ino
    ) {
      throw new Error("Project root changed while opening the scan.");
    }
  } catch (error) {
    await rootHandle.close().catch(() => undefined);
    if (signal?.aborted) throw error;
    throw new Error(`Project root is unsafe or inaccessible: ${rootPath}`, {
      cause: error,
    });
  }

  const files: ScannedFile[] = [];
  const state: WalkState = { aborted: false, contentBytes: 0, filesReserved: 0 };

  try {
    await walkDir(rootHandle, "", canonicalRootPath, files, state, 0, signal);
  } finally {
    await rootHandle.close().catch(() => undefined);
  }
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
    rootPath: canonicalRootPath,
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
      sourceRoot: canonicalRootPath,
      files: manifestFiles,
      completeness: state.aborted ? "PARTIAL" : "COMPLETE",
    },
  };
}
