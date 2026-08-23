import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ReplitConnectors } from "@replit/connectors-sdk";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 50 * 1024 * 1024;

type GitHubRemote = {
  owner: string;
  repo: string;
};

type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob";
  sha: string | null;
};

type GitHubRequest = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Record<string, unknown>>;

export class GitHubConnectorError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "GitHubConnectorError";
    this.code = code;
    this.status = status;
  }
}

export function parseGitHubRemote(remoteUrl: string): GitHubRemote | undefined {
  try {
    const url = new URL(remoteUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password
    ) return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return undefined;
    const repo = parts[1].replace(/\.git$/, "");
    if (!parts[0] || !repo || url.search || url.hash) return undefined;
    return { owner: parts[0], repo };
  } catch {
    return undefined;
  }
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function branchPath(branch: string): string {
  return branch.split("/").map(encodePathPart).join("/");
}

function repoPath(remote: GitHubRemote, suffix: string): string {
  return `/repos/${encodePathPart(remote.owner)}/${encodePathPart(remote.repo)}${suffix}`;
}

async function gitText(rootPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    maxBuffer: GIT_MAX_BUFFER,
    encoding: "utf8",
  });
  return String(result.stdout).trim();
}

async function gitBlob(rootPath: string, commitHash: string, filePath: string): Promise<Buffer> {
  const result = await execFileAsync(
    "git",
    ["-C", rootPath, "cat-file", "blob", `${commitHash}:${filePath}`],
    { maxBuffer: GIT_MAX_BUFFER, encoding: "buffer" },
  );
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout));
}

async function gitMode(rootPath: string, commitHash: string, filePath: string): Promise<string> {
  const line = await gitText(rootPath, ["ls-tree", commitHash, "--", filePath]);
  const mode = line.split(/\s+/, 1)[0];
  return mode === "100755" ? mode : "100644";
}

async function defaultGitHubRequest(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Record<string, unknown>> {
  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("github", path, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!response.ok) {
      const message = typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `GitHub API returned HTTP ${response.status}`;
      throw new GitHubConnectorError(message, "GITHUB_API_ERROR", response.status);
    }
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch (error) {
    if (error instanceof GitHubConnectorError) throw error;
    throw new GitHubConnectorError(
      error instanceof Error ? error.message : "GitHub connector request failed",
      "GITHUB_CONNECTOR_UNAVAILABLE",
    );
  }
}

function parseChangedPaths(raw: string): Array<{ kind: "upsert" | "delete"; path: string }> {
  const tokens = raw.split("\0").filter(Boolean);
  const changes: Array<{ kind: "upsert" | "delete"; path: string }> = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) continue;
    if (status.startsWith("R")) {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (oldPath) changes.push({ kind: "delete", path: oldPath });
      if (newPath) changes.push({ kind: "upsert", path: newPath });
      continue;
    }
    if (status.startsWith("C")) {
      index++;
      const copiedPath = tokens[index++];
      if (copiedPath) changes.push({ kind: "upsert", path: copiedPath });
      continue;
    }
    const filePath = tokens[index++];
    if (!filePath) continue;
    changes.push({ kind: status.startsWith("D") ? "delete" : "upsert", path: filePath });
  }
  return changes;
}

/**
 * Push a verified local commit to GitHub through the Replit connector.
 *
 * GitHub's REST API cannot receive a local git pack directly, so this mirrors
 * the single verified commit as GitHub blob/tree/commit objects. The remote
 * branch must still point at the local commit's parent; otherwise this fails
 * closed instead of overwriting remote work.
 */
export async function pushLocalCommitToGitHub(args: {
  rootPath: string;
  remote: GitHubRemote;
  branch: string;
  commitHash: string;
  message: string;
  request?: GitHubRequest;
}): Promise<{ remoteCommitHash: string; changedPaths: string[] }> {
  const request = args.request ?? defaultGitHubRequest;
  const parents = (await gitText(args.rootPath, ["rev-list", "--parents", "-n", "1", args.commitHash]))
    .split(/\s+/)
    .filter(Boolean);
  if (parents.length !== 2) {
    throw new GitHubConnectorError("Only single-parent commits can be pushed through the GitHub connector", "GITHUB_PUSH_UNSUPPORTED_COMMIT");
  }
  const localParent = parents[1];
  const ref = await request(repoPath(args.remote, `/git/ref/heads/${branchPath(args.branch)}`));
  const remoteCommitHash = typeof (ref.object as { sha?: unknown } | undefined)?.sha === "string"
    ? (ref.object as { sha: string }).sha
    : undefined;
  if (!remoteCommitHash) {
    throw new GitHubConnectorError("GitHub branch reference did not return a commit", "GITHUB_API_INVALID_RESPONSE");
  }
  if (remoteCommitHash === args.commitHash) {
    return { remoteCommitHash, changedPaths: [] };
  }
  if (remoteCommitHash !== localParent) {
    throw new GitHubConnectorError(
      "GitHub branch changed after the verified local commit; pull/reconcile before pushing",
      "GITHUB_PUSH_REMOTE_DRIFT",
    );
  }

  const commit = await request(repoPath(args.remote, `/git/commits/${encodePathPart(remoteCommitHash)}`));
  const baseTree = typeof (commit.tree as { sha?: unknown } | undefined)?.sha === "string"
    ? (commit.tree as { sha: string }).sha
    : undefined;
  if (!baseTree) {
    throw new GitHubConnectorError("GitHub commit did not return a base tree", "GITHUB_API_INVALID_RESPONSE");
  }

  const changes = parseChangedPaths(await gitText(
    args.rootPath,
    ["diff-tree", "--no-commit-id", "--name-status", "-z", "-M", localParent, args.commitHash, "--"],
  ));
  if (changes.length === 0) {
    throw new GitHubConnectorError("The verified local commit has no changed files", "GITHUB_PUSH_EMPTY_COMMIT");
  }

  const tree: GitHubTreeEntry[] = [];
  for (const change of changes) {
    if (change.kind === "delete") {
      tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const content = await gitBlob(args.rootPath, args.commitHash, change.path);
    const blob = await request(repoPath(args.remote, "/git/blobs"), {
      method: "POST",
      body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
    });
    if (typeof blob.sha !== "string") {
      throw new GitHubConnectorError("GitHub blob creation returned no sha", "GITHUB_API_INVALID_RESPONSE");
    }
    tree.push({
      path: change.path,
      mode: await gitMode(args.rootPath, args.commitHash, change.path),
      type: "blob",
      sha: blob.sha,
    });
  }

  const createdTree = await request(repoPath(args.remote, "/git/trees"), {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  if (typeof createdTree.sha !== "string") {
    throw new GitHubConnectorError("GitHub tree creation returned no sha", "GITHUB_API_INVALID_RESPONSE");
  }

  const createdCommit = await request(repoPath(args.remote, "/git/commits"), {
    method: "POST",
    body: JSON.stringify({
      message: args.message,
      tree: createdTree.sha,
      parents: [remoteCommitHash],
    }),
  });
  if (typeof createdCommit.sha !== "string") {
    throw new GitHubConnectorError("GitHub commit creation returned no sha", "GITHUB_API_INVALID_RESPONSE");
  }

  await request(repoPath(args.remote, `/git/refs/heads/${branchPath(args.branch)}`), {
    method: "PATCH",
    body: JSON.stringify({ sha: createdCommit.sha, force: false }),
  });
  return {
    remoteCommitHash: createdCommit.sha,
    changedPaths: [...new Set(changes.map((change) => change.path))],
  };
}