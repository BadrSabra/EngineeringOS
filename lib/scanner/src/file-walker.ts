import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";

/** Maximum bytes to read per file for content analysis (512 KB). */
const MAX_CONTENT_BYTES = 512 * 1024;

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
}

async function walkDir(
  dir: string,
  rootPath: string,
  files: ScannedFile[],
  depth = 0,
): Promise<void> {
  if (depth > 12) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) return;
        await walkDir(join(dir, entry.name), rootPath, files, depth + 1);
      } else if (entry.isFile()) {
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
 * If `rootPath` does not exist on disk the walker falls back to the current
 * working directory so EngineeringOS can always scan itself.
 */
export async function walkProject(rootPath: string): Promise<WalkResult> {
  let resolvedRoot = rootPath;
  let rootExists = true;

  try {
    const s = await stat(rootPath);
    if (!s.isDirectory()) throw new Error("not a directory");
  } catch {
    resolvedRoot = process.cwd();
    rootExists = false;
  }

  const files: ScannedFile[] = [];
  await walkDir(resolvedRoot, resolvedRoot, files);

  const sourceFiles = files.filter(
    (f) =>
      f.language !== "markdown" &&
      f.language !== "json" &&
      f.language !== "yaml" &&
      f.language !== "toml",
  ).length;

  return {
    files,
    rootPath: resolvedRoot,
    rootExists,
    totalFiles: files.length,
    sourceFiles,
  };
}
