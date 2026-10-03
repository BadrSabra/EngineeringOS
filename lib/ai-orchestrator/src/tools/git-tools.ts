/**
 * Git tools for the chat agent.
 *
 * Read-only operations (status, diff, log) are executed immediately.
 * Write operations (commit, push) are handled via dedicated API endpoints
 * in the dashboard — the AI only proposes them, the user approves + triggers.
 *
 * All commands run via execFile (no shell) with the project rootPath as the
 * working directory (-C flag).  Token injection for authenticated push is
 * handled exclusively in the API layer, never here.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { safePath } from "./file-tools.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 512 * 1024; // 512 KB

export class GitToolPathRejectedError extends Error {
  constructor() {
    super("Git diff path could not be verified inside the project root.");
    this.name = "GitToolPathRejectedError";
  }
}

// ── Tool definitions (sent to Groq) ──────────────────────────────────────────

export type GitToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const GIT_TOOL_DEFINITIONS: GitToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "git_status",
      description:
        "Show the working-tree status: which files are modified, added, deleted, or untracked. " +
        "Run this before proposing a commit message or reviewing pending changes.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description:
        "Show the diff of all uncommitted changes (staged and unstaged) against HEAD. " +
        "Optionally filter to a single file. Use this to review what will go into the next commit.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: 4_096,
            description:
              "Optional: project-relative path to a specific file. Omit to show all changes.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description:
        "Show the last 15 commits as one-line summaries (hash · date · message). " +
        "Use this to understand recent history or pick a base for a new commit message.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

// ── Execution ─────────────────────────────────────────────────────────────────

async function safeGit(
  args: string[],
  rootPath: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", rootPath, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      signal,
    });
    const out = stdout.trim();
    const err = stderr.trim();
    return out + (err ? `\n[git stderr]: ${err}` : "");
  } catch (err: unknown) {
    if (signal?.aborted) throw err;
    const e = err as { stderr?: string; stdout?: string; message?: string };
    // Prefer stderr for git errors — it's more informative than the exit message.
    return `[git error]: ${e.stderr?.trim() || e.message || String(err)}`;
  }
}

export async function executeGitTool(
  name: string,
  args: Record<string, string>,
  rootPath: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  switch (name) {
    case "git_status": {
      const out = await safeGit(["status", "--short", "-u"], rootPath, signal);
      return out || "Working tree clean — nothing to commit.";
    }

    case "git_diff": {
      // Show all uncommitted changes (staged + unstaged) against HEAD.
      const gitArgs = ["diff", "HEAD"];
      if (args.path) {
        // Keep Git pathspecs inside the same canonical project root used by
        // file tools. Lexical containment alone does not reject an in-root
        // symlink that resolves to an external file.
        let resolvedRoot: string;
        try {
          resolvedRoot = await fs.realpath(path.resolve(rootPath));
        } catch {
          throw new GitToolPathRejectedError();
        }
        try {
          if (!(await safePath(resolvedRoot, args.path))) {
            throw new GitToolPathRejectedError();
          }
        } catch (error) {
          if (error instanceof GitToolPathRejectedError) throw error;
          throw new GitToolPathRejectedError();
        }
        gitArgs.push("--", args.path);
      }
      const out = await safeGit(gitArgs, rootPath, signal);
      return out || "No uncommitted changes.";
    }

    case "git_log": {
      const out = await safeGit(
        ["log", "--oneline", "--decorate", "--format=%h %ad %s", "--date=short", "-15"],
        rootPath,
        signal,
      );
      return out || "No commits yet in this repository.";
    }

    default:
      return `[git-tools]: Unknown tool "${name}" — available tools: git_status, git_diff, git_log`;
  }
}
