import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";

/** Maximum bytes to read per file for content analysis (512 KB). */
const MAX_CONTENT_BYTES = 512 * 1024;

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

export interface WalkResult {
  files: ScannedFile[];
  rootPath: string;
  /** Whether rootPath actually existed on disk. */
  rootExists: boolean;
  totalFiles: number;
  sourceFiles: number;
  /**
   * PR-04: True when the walk was stopped early due to a hard cap (file count
   * or depth limit). Callers should surface this to the user so they know the
   * scan result is incomplete rather than assuming full coverage.
   */
  truncated: boolean;
  /**
   * PR-04: Human-readable reason for truncation, when `truncated` is true.
   * Machine-parseable prefix before the colon: "file_limit", "depth_limit".
   */
  truncationReason?: string;
  /**
   * PR-04: Approximate number of source files skipped due to the cap.
   * Only meaningful when `truncated` is true. -1 means the count is unknown
   * (scan was aborted before all skipped files were counted).
   */
  filesSkipped: number;
}

/** Mutable walk state — shared across the recursive walkDir calls. */
interface WalkState {
  aborted: boolean;
  truncationReason?: string;
}

async function walkDir(
  dir: string,
  rootPath: string,
  files: ScannedFile[],
  state: WalkState,
  depth = 0,
): Promise<void> {
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
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (state.aborted) return; // respect abort in concurrent branches

      if (entry.isDirectory()) {
        // Skip dot-directories but allow .github (CI/CD workflows live there).
        if (IGNORE_DIRS.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".github")) return;
        await walkDir(join(dir, entry.name), rootPath, files, state, depth + 1);
      } else if (entry.isFile()) {
        if (state.aborted || files.length >= MAX_FILES) {
          state.aborted = true;
          if (!state.truncationReason) state.truncationReason = `file_limit:${MAX_FILES}`;
          return;
        }

        const ext = extname(entry.name).toLowerCase();
        const language = LANGUAGE_MAP[ext];
        if (!language) return;

        const absPath = join(dir, entry.name);
        const relPath = relative(rootPath, absPath);

        let fileStat;
        try {
          fileStat = await stat(absPath);
        } catch {
          return;
        }

        const size = fileStat.size;
        let content = "";
        let oversized = false;

        if (size <= MAX_CONTENT_BYTES) {
          try {
            content = await readFile(absPath, "utf8");
          } catch {
            content = "";
          }
        } else {
          oversized = true;
        }

        const lines = content ? content.split("\n").length : 0;

        files.push({ path: relPath, absPath, language, size, lines, content, oversized });
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
export async function walkProject(rootPath: string): Promise<WalkResult> {
  try {
    const s = await stat(rootPath);
    if (!s.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${rootPath}`);
    }
  } catch (statErr) {
    if (statErr instanceof Error && statErr.message.startsWith("Path exists but")) {
      throw statErr;
    }
    throw new Error(`Project root does not exist or is inaccessible: ${rootPath}`);
  }

  const files: ScannedFile[] = [];
  const state: WalkState = { aborted: false };

  await walkDir(rootPath, rootPath, files, state);

  const sourceFiles = files.filter(
    (f) =>
      f.language !== "markdown" &&
      f.language !== "json" &&
      f.language !== "yaml" &&
      f.language !== "toml",
  ).length;

  return {
    files,
    rootPath,
    rootExists: true,
    totalFiles: files.length,
    sourceFiles,
    truncated: state.aborted,
    truncationReason: state.truncationReason,
    // When aborted by file count, skipped count is unknown (Promise.all
    // branches were concurrent); signal with -1.
    filesSkipped: state.aborted ? -1 : 0,
  };
}
