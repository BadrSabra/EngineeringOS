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
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 512 * 1024; // 512 KB

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
      parameters: { type: "object", properties: {}, required: [] },
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
            description:
              "Optional: project-relative path to a specific file. Omit to show all changes.",
          },
        },
        required: [],
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
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ── Execution ─────────────────────────────────────────────────────────────────

async function safeGit(args: string[], rootPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", rootPath, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    const out = stdout.trim();
    const err = stderr.trim();
    return out + (err ? `\n[git stderr]: ${err}` : "");
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    // Prefer stderr for git errors — it's more informative than the exit message.
    return `[git error]: ${e.stderr?.trim() || e.message || String(err)}`;
  }
}

export async function executeGitTool(
  name: string,
  args: Record<string, string>,
  rootPath: string,
): Promise<string> {
  switch (name) {
    case "git_status": {
      const out = await safeGit(["status", "--short", "-u"], rootPath);
      return out || "Working tree clean — nothing to commit.";
    }

    case "git_diff": {
      // Show all uncommitted changes (staged + unstaged) against HEAD.
      const gitArgs = ["diff", "HEAD"];
      if (args.path) {
        // D-01: Bounds-check the path before handing it to git, mirroring the
        // safePath guard in file-tools.ts.  git -C rootPath handles the
        // working-directory, but a traversal like "../../other-project" would
        // still resolve outside the project root if the git repo's root is an
        // ancestor directory.  We reject any resolved path that escapes rootPath
        // before the "--" separator is added to the git command.
        const normalRoot = path.resolve(rootPath);
        const resolved   = path.resolve(rootPath, args.path);
        if (resolved !== normalRoot && !resolved.startsWith(normalRoot + path.sep)) {
          return `[git-tools]: Rejected — path "${args.path}" resolves outside the project root.`;
        }
        gitArgs.push("--", args.path);
      }
      const out = await safeGit(gitArgs, rootPath);
      return out || "No uncommitted changes.";
    }

    case "git_log": {
      const out = await safeGit(
        ["log", "--oneline", "--decorate", "--format=%h %ad %s", "--date=short", "-15"],
        rootPath,
      );
      return out || "No commits yet in this repository.";
    }

    default:
      return `[git-tools]: Unknown tool "${name}" — available tools: git_status, git_diff, git_log`;
  }
}
