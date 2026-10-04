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
import { constants as fsConstants, promises as fs } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { safePath } from "./file-tools.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 512 * 1024; // 512 KB

type PinnedGitRoot = {
  canonicalPath: string;
  procPath: string;
  handle: fs.FileHandle;
};

async function openPinnedGitRoot(rootPath: string): Promise<PinnedGitRoot> {
  const canonicalPath = await fs.realpath(path.resolve(rootPath));
  const before = await fs.stat(canonicalPath);
  if (!before.isDirectory()) throw new Error("git_root_not_directory");

  const handle = await fs.open(
    canonicalPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isDirectory()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
    ) {
      throw new Error("git_root_identity_changed");
    }
    return {
      canonicalPath,
      // Keep the directory descriptor open until the child exits. This pins
      // its cwd even if the project path is renamed or replaced after checks.
      procPath: `/proc/${process.pid}/fd/${handle.fd}`,
      handle,
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function safeGitEnvironment(): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  ) as NodeJS.ProcessEnv;
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  return environment;
}

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
  root: PinnedGitRoot,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  try {
    const { stdout, stderr } = await execFileAsync("git", [
      "--no-pager",
      "-c", "core.fsmonitor=false",
      "-c", "core.pager=cat",
      "-c", "diff.external=",
      ...args,
    ], {
      cwd: root.procPath,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      signal,
      env: safeGitEnvironment(),
    });
    // Preserve Git porcelain's leading status columns; only discard terminal
    // line breaks, not the space that distinguishes staged from unstaged state.
    const out = stdout.trimEnd();
    const err = stderr.trimEnd();
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
  let root: PinnedGitRoot;
  try {
    root = await openPinnedGitRoot(rootPath);
  } catch (error) {
    if (signal?.aborted) throw error;
    return "[git error]: Project root could not be verified.";
  }
  try {
    switch (name) {
      case "git_status": {
        const out = await safeGit(["status", "--short", "-u"], root, signal);
        return out || "Working tree clean — nothing to commit.";
      }

      case "git_diff": {
        // Show all uncommitted changes (staged + unstaged) against HEAD.
        const gitArgs = [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "HEAD",
        ];
        if (args.path) {
          // Normalize the validated path before handing it to Git. Literal
          // pathspec mode prevents wildcard characters from widening scope.
          try {
            const safe = await safePath(root.canonicalPath, args.path);
            if (!safe) throw new GitToolPathRejectedError();
            const relative = path.relative(root.canonicalPath, safe);
            gitArgs.push("--", relative || ".");
          } catch (error) {
            if (error instanceof GitToolPathRejectedError) throw error;
            throw new GitToolPathRejectedError();
          }
        }
        const out = await safeGit(gitArgs, root, signal);
        return out || "No uncommitted changes.";
      }

      case "git_log": {
        const out = await safeGit(
          ["log", "--oneline", "--decorate", "--format=%h %ad %s", "--date=short", "-15"],
          root,
          signal,
        );
        return out || "No commits yet in this repository.";
      }

      default:
        return `[git-tools]: Unknown tool "${name}" — available tools: git_status, git_diff, git_log`;
    }
  } finally {
    await root.handle.close();
  }
}
