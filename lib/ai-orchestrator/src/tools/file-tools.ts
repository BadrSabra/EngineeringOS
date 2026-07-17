/**
 * File system tools for the chat agent.
 *
 * Activated only when `rootPath` is passed to the chat function, giving the
 * model read and write access to the actual project source files.
 *
 * Security contract:
 *   - rootPath is resolved with fs.realpath once per executeFileTool call.
 *   - All caller-supplied paths are checked lexically first, then with
 *     fs.realpath so that symlinks pointing outside the root are caught.
 *   - Null bytes are rejected explicitly before any path operation.
 *   - read_file / list_directory / search_code execute immediately.
 *   - write_file NEVER writes to disk — it queues a PendingChange that the
 *     user must explicitly approve via the dashboard before anything changes.
 *   - search_code uses execFile (no shell) so the pattern and root path are
 *     passed as plain argv entries, never interpolated into a shell string.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type PendingChange } from "../schemas/chat.schema.js";

const execFileAsync = promisify(execFile);

const MAX_READ_BYTES = 80_000; // ~80 KB per file read
const MAX_SEARCH_LINES = 50;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "__pycache__", ".venv", "build", "coverage"]);

// ── Public types ─────────────────────────────────────────────────────────────

// PendingChange is the canonical type from chat.schema.ts — re-exported here
// so callers that already import from file-tools.ts do not need to change their
// import path. The single schema in chat.schema.ts is the sole source of truth.
export type { PendingChange } from "../schemas/chat.schema.js";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// ── Tool definitions (sent to Groq) ──────────────────────────────────────────

export const FILE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the full contents of a source file. Use this before answering implementation questions or proposing changes — never guess at code you haven't read.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path relative to the project root (e.g. 'src/index.ts', 'lib/auth.py').",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List the files and sub-directories in a directory of the project.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path relative to the project root. Use '.' to list the root itself.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search for a text or regex pattern across all source files. Returns matching lines with file path and line number.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Plain text or basic regex pattern to search for.",
          },
          file_glob: {
            type: "string",
            description:
              "Optional glob to restrict the search to specific file types (e.g. '*.ts', '*.py'). Omit to search all files.",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Propose a file write or modification. The change is QUEUED for user approval and is NOT written to disk until the user explicitly approves it. Always read the file first before proposing a modification so you write the complete corrected content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the project root.",
          },
          content: {
            type: "string",
            description: "The complete new file content (not a diff — the full replacement).",
          },
          reason: {
            type: "string",
            description: "One-sentence explanation of why this change is needed.",
          },
        },
        required: ["path", "content", "reason"],
      },
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escape a string for use as a literal inside a RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a caller-supplied path and verify it stays inside `resolvedRoot`.
 *
 * Two-phase check:
 *   1. Lexical: path.resolve removes `..` segments — fast rejection of
 *      pure-string traversal attempts.
 *   2. Realpath: fs.realpath follows symlinks on disk — catches symlinks
 *      inside the root that point to paths outside it.
 *
 * For paths that do not yet exist (new files queued by write_file), realpath
 * is applied to the nearest existing ancestor instead.
 *
 * Returns the canonical absolute path on success, null on any violation.
 */
async function safePath(resolvedRoot: string, filePath: string): Promise<string | null> {
  // Null bytes are passed to OS path APIs as-is, where libc treats them as
  // string terminators. Node's fs layer rejects them, but the error message
  // is confusing. Catch them here with a clear early return.
  if (filePath.includes("\0")) return null;

  // Phase 1 — lexical. Catches all `..`-based traversal without I/O.
  const lexical = path.resolve(resolvedRoot, filePath);
  if (lexical !== resolvedRoot && !lexical.startsWith(resolvedRoot + path.sep)) {
    return null;
  }

  // Phase 2 — realpath. Resolves symlinks so a link inside the root that
  // points outside it does not slip through the lexical check.
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch {
    // The path doesn't exist yet (e.g. a new file). Resolve the nearest
    // existing ancestor and re-attach the remaining segments.
    let ancestor = lexical;
    let tail = "";
    for (;;) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        // Reached the filesystem root without finding an existing ancestor.
        // Fall back to the lexically-verified path — the lexical check above
        // already confirmed it is inside the root.
        real = lexical;
        break;
      }
      tail = tail ? path.join(path.basename(ancestor), tail) : path.basename(ancestor);
      ancestor = parent;
      try {
        const realAncestor = await fs.realpath(ancestor);
        real = path.join(realAncestor, tail);
        break;
      } catch {
        // This ancestor also doesn't exist — go up one more level.
        continue;
      }
    }
  }

  // Phase 2 prefix check on the resolved (real) path.
  if (real !== resolvedRoot && !real.startsWith(resolvedRoot + path.sep)) {
    return null;
  }

  return real;
}

// ── Tool handler ──────────────────────────────────────────────────────────────

/**
 * Execute one tool call from the model. Returns a string that gets added as
 * the tool-result message. For write_file the actual write is deferred —
 * the change is pushed to `pendingChanges` instead.
 */
export async function executeFileTool(
  toolName: string,
  args: Record<string, string>,
  rootPath: string,
  pendingChanges: PendingChange[],
): Promise<string> {
  // Resolve the root once with realpath so every safePath call in this
  // invocation uses the same canonical base. This also catches a rootPath
  // that is itself a symlink pointing somewhere unexpected, and provides a
  // single early failure point if the root has been removed.
  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(path.resolve(rootPath));
  } catch {
    return "Error: project root path does not exist or is not accessible.";
  }

  switch (toolName) {
    // ── read_file ─────────────────────────────────────────────────────────────
    case "read_file": {
      const abs = await safePath(resolvedRoot, args.path ?? "");
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;
      try {
        const buf = await fs.readFile(abs);
        // Slice the buffer BEFORE decoding to UTF-8: without this, a file
        // close to the limit with multi-byte characters could expand beyond
        // MAX_READ_BYTES in the string representation.
        const truncated = buf.length > MAX_READ_BYTES;
        const sliced = truncated ? buf.subarray(0, MAX_READ_BYTES) : buf;
        const text = sliced.toString("utf-8");
        const content = truncated ? text + "\n\n[... truncated at 80 KB ...]" : text;
        return `File: ${args.path}\n\`\`\`\n${content}\n\`\`\``;
      } catch (e) {
        return `Error reading "${args.path}": ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── list_directory ────────────────────────────────────────────────────────
    case "list_directory": {
      const target = args.path ?? ".";
      const abs = await safePath(resolvedRoot, target);
      if (!abs) return `Error: "${target}" resolves outside the project root.`;
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const lines = entries
          .filter((e) => !SKIP_DIRS.has(e.name))
          .sort((a, b) => {
            // Directories first, then files, alphabetically.
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((e) => `${e.isDirectory() ? "[dir]  " : "[file] "}${e.name}`)
          .join("\n");
        return `Contents of "${target}":\n${lines || "(empty)"}`;
      } catch (e) {
        return `Error listing "${target}": ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── search_code ───────────────────────────────────────────────────────────
    case "search_code": {
      if (!args.pattern) return 'Error: "pattern" argument is required.';
      if (args.pattern.includes("\0")) return 'Error: "pattern" must not contain null bytes.';

      // Build the argv array directly — no shell is involved so no quoting or
      // escaping is needed. The pattern and root path are passed as opaque
      // strings to execFile, which hands them to the OS via execve.
      const grepArgs: string[] = [
        "-r",   // recursive
        "-n",   // line numbers
        "-m", "5", // at most 5 matches per file (limits per-file output)
      ];

      if (args.file_glob) {
        if (args.file_glob.includes("\0")) return 'Error: "file_glob" must not contain null bytes.';
        grepArgs.push("--include", args.file_glob);
      }

      // "--" ends option parsing: prevents a pattern starting with "-" from
      // being treated as a grep flag even though there is no shell involved.
      grepArgs.push("--", args.pattern, resolvedRoot);

      try {
        const { stdout } = await execFileAsync("grep", grepArgs, {
          timeout: 10_000,
          maxBuffer: 1_000_000, // 1 MB cap on raw output before line-slicing
        });
        // Strip the absolute root prefix from every output line so the model
        // sees project-relative paths. Escape the root for literal RegExp use.
        const relative = stdout.replace(
          new RegExp(`^${escapeRegex(resolvedRoot)}/`, "gm"),
          "",
        );
        const lines = relative.trim().split("\n").slice(0, MAX_SEARCH_LINES).join("\n");
        return lines || "No matches found.";
      } catch (err) {
        const e = err as { code?: unknown; killed?: boolean; message?: string };
        // grep exits 1 when no lines match — not an error.
        if (e.code === 1) return "No matches found.";
        // Timeout: execFile sets killed=true when the timeout fires.
        if (e.killed) return "Error: search timed out. Try a more specific pattern or a narrower root path.";
        // grep binary missing on this system.
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return "Error: grep is not available in this environment.";
        // Catch-all for anything else (ENOMEM, permission denied, etc.)
        return `Error: search failed (${(e as Error).message ?? "unknown reason"}).`;
      }
    }

    // ── write_file ────────────────────────────────────────────────────────────
    case "write_file": {
      if (!args.path || args.content === undefined) {
        return 'Error: "path" and "content" are required.';
      }
      const abs = await safePath(resolvedRoot, args.path);
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;

      // Reject a write targeting the project root directory itself.
      // safePath returns resolvedRoot when filePath resolves to exactly the
      // root (e.g. args.path is "" or "."), which would queue a change for a
      // directory rather than a file.
      if (abs === resolvedRoot) {
        return 'Error: "path" must be a file path, not the project root directory.';
      }

      // Read the current file content so the UI can show a proper diff.
      let originalContent: string | null = null;
      try {
        originalContent = await fs.readFile(abs, "utf-8");
      } catch {
        // File doesn't exist yet — that's fine for new files.
      }

      // Normalize the stored relative path so the UI always shows a canonical
      // form (e.g. "src/foo.ts" rather than "./src/foo.ts" or "src/../src/foo.ts").
      const relativePath = path.relative(resolvedRoot, abs);

      pendingChanges.push({
        path: relativePath,
        absolutePath: abs,
        newContent: args.content,
        originalContent,
        reason: args.reason ?? "No reason provided",
      });

      return `Change queued for "${relativePath}" — reason: ${args.reason ?? "(none)"}. The change has NOT been written to disk. The user will see a diff and must approve it before anything changes.`;
    }

    default:
      return `Unknown tool: "${toolName}".`;
  }
}
