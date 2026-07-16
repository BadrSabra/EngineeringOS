/**
 * File system tools for the chat agent.
 *
 * Activated only when `rootPath` is passed to the chat function, giving the
 * model read and write access to the actual project source files.
 *
 * Security contract:
 *   - All paths are resolved and verified to stay inside `rootPath`.
 *   - read_file / list_directory / search_code execute immediately.
 *   - write_file NEVER writes to disk — it queues a PendingChange that the
 *     user must explicitly approve via the dashboard before anything changes.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_READ_BYTES = 80_000; // ~80 KB per file read
const MAX_SEARCH_LINES = 50;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "__pycache__", ".venv", "build", "coverage"]);

// ── Public types ─────────────────────────────────────────────────────────────

export type PendingChange = {
  /** Path relative to project root — shown in the UI */
  path: string;
  /** Absolute path on disk — used by the apply-changes endpoint */
  absolutePath: string;
  /** Complete new content to write */
  newContent: string;
  /** Existing content before the change, null if the file doesn't exist yet */
  originalContent: string | null;
  /** One-sentence reason from the model */
  reason: string;
};

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
 * Resolve a user-supplied relative path and verify it stays inside rootPath.
 * Returns the absolute path on success, null on traversal attempt.
 */
function safePath(rootPath: string, filePath: string): string | null {
  const resolved = path.resolve(rootPath, filePath);
  const resolvedRoot = path.resolve(rootPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolved;
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
  switch (toolName) {
    // ── read_file ─────────────────────────────────────────────────────────────
    case "read_file": {
      const abs = safePath(rootPath, args.path ?? "");
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;
      try {
        const buf = await fs.readFile(abs);
        const text = buf.toString("utf-8");
        const content =
          text.length > MAX_READ_BYTES
            ? text.slice(0, MAX_READ_BYTES) + "\n\n[... truncated at 80 KB ...]"
            : text;
        return `File: ${args.path}\n\`\`\`\n${content}\n\`\`\``;
      } catch (e) {
        return `Error reading "${args.path}": ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── list_directory ────────────────────────────────────────────────────────
    case "list_directory": {
      const target = args.path ?? ".";
      const abs = safePath(rootPath, target);
      if (!abs) return `Error: "${target}" resolves outside the project root.`;
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const lines = entries
          .filter((e) => !SKIP_DIRS.has(e.name))
          .sort((a, b) => {
            // Directories first, then files, alphabetically
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
      try {
        const safePattern = args.pattern.replace(/'/g, "'\\''");
        const includeFlag = args.file_glob
          ? `--include='${args.file_glob.replace(/'/g, "")}'`
          : "";
        const safeRoot = path.resolve(rootPath).replace(/'/g, "'\\''");
        const cmd = [
          "grep",
          "-r",
          "-n",
          "-m 5",
          includeFlag,
          `'${safePattern}'`,
          `'${safeRoot}'`,
          "2>/dev/null",
          `| head -${MAX_SEARCH_LINES}`,
        ]
          .filter(Boolean)
          .join(" ");
        const { stdout } = await execAsync(cmd, { timeout: 10_000 });
        const relative = stdout.replace(new RegExp(path.resolve(rootPath) + "/", "g"), "");
        return relative.trim() || "No matches found.";
      } catch {
        // grep exits 1 when no matches — not an error
        return "No matches found.";
      }
    }

    // ── write_file ────────────────────────────────────────────────────────────
    case "write_file": {
      if (!args.path || args.content === undefined) {
        return 'Error: "path" and "content" are required.';
      }
      const abs = safePath(rootPath, args.path);
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;

      // Read the current file content so the UI can show a proper diff
      let originalContent: string | null = null;
      try {
        originalContent = await fs.readFile(abs, "utf-8");
      } catch {
        // File doesn't exist yet — that's fine for new files
      }

      pendingChanges.push({
        path: args.path,
        absolutePath: abs,
        newContent: args.content,
        originalContent,
        reason: args.reason ?? "No reason provided",
      });

      return `Change queued for "${args.path}" — reason: ${args.reason ?? "(none)"}. The change has NOT been written to disk. The user will see a diff and must approve it before anything changes.`;
    }

    default:
      return `Unknown tool: "${toolName}".`;
  }
}
