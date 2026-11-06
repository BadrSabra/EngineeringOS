import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ReplitConnectors } from "@replit/connectors-sdk";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 50 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 30_000;
const GITHUB_REQUEST_TIMEOUT_MS = 20_000;

export type GitHubRemote = {
  owner: string;
  repo: string;
};

type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob";
  sha: string | null;
};

export type GitHubRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Used only server-side and stripped before the SDK fetch is invoked. */
  accessToken?: string;
};

export type GitHubRequest = (
  path: string,
  init?: GitHubRequestInit,
) => Promise<Record<string, unknown>>;

export type GitHubBranchState = {
  commitHash: string;
  treeHash: string;
  message: string;
  parentHashes: string[];
};

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

function withSignal(request: GitHubRequest, signal?: AbortSignal): GitHubRequest {
  return (path, init = {}) => request(path, {
    ...init,
    ...(signal ? { signal } : {}),
  });
}

function withAccessToken(request: GitHubRequest, accessToken?: string): GitHubRequest {
  return (path, init = {}) => request(path, {
    ...init,
    ...(accessToken ? { accessToken } : {}),
  });
}

export function createGitHubRequest(
  accessToken: string,
  request: GitHubRequest = defaultGitHubRequest,
): GitHubRequest {
  if (!accessToken.trim()) {
    throw new GitHubConnectorError("A GitHub personal access token is required.", "GITHUB_TOKEN_REQUIRED");
  }
  return withAccessToken(request, accessToken);
}

async function gitText(rootPath: string, args: string[], signal?: AbortSignal): Promise<string> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    timeout: GIT_COMMAND_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: "utf8",
    ...(signal ? { signal } : {}),
  });
  return String(result.stdout).trim();
}

async function gitCommitIdentities(rootPath: string, commitHash: string, signal?: AbortSignal): Promise<{
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
}> {
  const result = await execFileAsync("git", [
    "-C", rootPath,
    "show", "-s", "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI",
    commitHash,
  ], {
    timeout: GIT_COMMAND_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: "utf8",
    ...(signal ? { signal } : {}),
  });
  const [authorName, authorEmail, authorDate, committerName, committerEmail, committerDate] =
    String(result.stdout).trimEnd().split("\0");
  if (
    !authorName || !authorEmail || !authorDate
    || !committerName || !committerEmail || !committerDate
  ) {
    throw new GitHubConnectorError(
      "The verified local commit has incomplete author or committer metadata.",
      "GITHUB_COMMIT_METADATA_INVALID",
    );
  }
  return {
    author: { name: authorName, email: authorEmail, date: authorDate },
    committer: { name: committerName, email: committerEmail, date: committerDate },
  };
}

async function gitBlob(rootPath: string, commitHash: string, filePath: string, signal?: AbortSignal): Promise<Buffer> {
  const result = await execFileAsync(
    "git",
    ["-C", rootPath, "cat-file", "blob", `${commitHash}:${filePath}`],
    {
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "buffer",
      ...(signal ? { signal } : {}),
    },
  );
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout));
}

async function gitMode(rootPath: string, commitHash: string, filePath: string, signal?: AbortSignal): Promise<string> {
  const line = await gitText(rootPath, ["ls-tree", commitHash, "--", filePath], signal);
  const mode = line.split(/\s+/, 1)[0];
  return mode === "100755" ? mode : "100644";
}

async function defaultGitHubRequest(
  path: string,
  init: GitHubRequestInit = {},
): Promise<Record<string, unknown>> {
  if (init.signal?.aborted) {
    throw new GitHubConnectorError("GitHub request was cancelled.", "GITHUB_REQUEST_CANCELLED");
  }
  const accessToken = init.accessToken;
  if (!accessToken?.trim()) {
    throw new GitHubConnectorError("A GitHub personal access token is required.", "GITHUB_TOKEN_REQUIRED");
  }
  const { accessToken: _accessToken, ...requestInit } = init;
  const controller = new AbortController();
  let timedOut = false;
  let rejectAborted!: (reason: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  const rejectOnAbort = () => rejectAborted(new Error("GitHub request aborted"));
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  const abortFromCaller = () => controller.abort(requestInit.signal?.reason);
  requestInit.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, GITHUB_REQUEST_TIMEOUT_MS);
  try {
    const connectors = new ReplitConnectors();
    const response = await Promise.race([connectors.createProxyFetch("github")(path, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        ...(requestInit.headers ?? {}),
        ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
    }), aborted]);
    const text = await Promise.race([response.text(), aborted]);
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
      throw new GitHubConnectorError(
        message.split(accessToken).join("[REDACTED]"),
        "GITHUB_API_ERROR",
        response.status,
      );
    }
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch (error) {
    if (error instanceof GitHubConnectorError) {
      if (error.message.includes(accessToken)) {
        throw new GitHubConnectorError(
          error.message.split(accessToken).join("[REDACTED]"),
          error.code,
          error.status,
        );
      }
      throw error;
    }
    if (timedOut) {
      throw new GitHubConnectorError(
        "GitHub request exceeded its time limit.",
        "GITHUB_REQUEST_TIMEOUT",
      );
    }
    if (requestInit.signal?.aborted) {
      throw new GitHubConnectorError(
        "GitHub request was cancelled.",
        "GITHUB_REQUEST_CANCELLED",
      );
    }
    throw new GitHubConnectorError(
      error instanceof Error
        ? error.message.split(accessToken).join("[REDACTED]")
        : "GitHub connector request failed",
      "GITHUB_CONNECTOR_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timeout);
    requestInit.signal?.removeEventListener("abort", abortFromCaller);
    controller.signal.removeEventListener("abort", rejectOnAbort);
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

export async function getGitHubBranchState(args: {
  remote: GitHubRemote;
  branch: string;
  request?: GitHubRequest;
  commitHash?: string;
  signal?: AbortSignal;
  accessToken?: string;
}): Promise<GitHubBranchState> {
  const request = withSignal(
    withAccessToken(args.request ?? defaultGitHubRequest, args.accessToken),
    args.signal,
  );
  const commitHash = args.commitHash ?? await (async () => {
    const ref = await request(repoPath(args.remote, `/git/ref/heads/${branchPath(args.branch)}`));
    return typeof (ref.object as { sha?: unknown } | undefined)?.sha === "string"
      ? (ref.object as { sha: string }).sha
      : undefined;
  })();
  if (!commitHash) {
    throw new GitHubConnectorError("GitHub branch reference did not return a commit", "GITHUB_API_INVALID_RESPONSE");
  }
  const commit = await request(repoPath(args.remote, `/git/commits/${encodePathPart(commitHash)}`));
  const treeHash = typeof (commit.tree as { sha?: unknown } | undefined)?.sha === "string"
    ? (commit.tree as { sha: string }).sha
    : undefined;
  if (!treeHash) {
    throw new GitHubConnectorError("GitHub commit did not return a tree", "GITHUB_API_INVALID_RESPONSE");
  }
  const parentHashes = Array.isArray(commit.parents)
    ? commit.parents
      .map((parent) => parent && typeof parent === "object" && typeof (parent as { sha?: unknown }).sha === "string"
        ? (parent as { sha: string }).sha
        : undefined)
      .filter((parent): parent is string => Boolean(parent))
    : [];
  return {
    commitHash,
    treeHash,
    message: typeof commit.message === "string" ? commit.message : "",
    parentHashes,
  };
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
  signal?: AbortSignal;
  accessToken?: string;
}): Promise<{ remoteCommitHash: string; changedPaths: string[] }> {
  const request = withSignal(
    withAccessToken(args.request ?? defaultGitHubRequest, args.accessToken),
    args.signal,
  );
  const parents = (await gitText(args.rootPath, ["rev-list", "--parents", "-n", "1", args.commitHash], args.signal))
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
  const branchState = await getGitHubBranchState({
    remote: args.remote,
    branch: args.branch,
    request,
    commitHash: remoteCommitHash,
    signal: args.signal,
  });

  const baseTree = branchState.treeHash;

  const changes = parseChangedPaths(await gitText(
    args.rootPath,
    ["diff-tree", "--no-commit-id", "--name-status", "-z", "-M", localParent, args.commitHash, "--"],
    args.signal,
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
    const content = await gitBlob(args.rootPath, args.commitHash, change.path, args.signal);
    const blob = await request(repoPath(args.remote, "/git/blobs"), {
      method: "POST",
      body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
    });
    if (typeof blob.sha !== "string") {
      throw new GitHubConnectorError("GitHub blob creation returned no sha", "GITHUB_API_INVALID_RESPONSE");
    }
    tree.push({
      path: change.path,
      mode: await gitMode(args.rootPath, args.commitHash, change.path, args.signal),
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

  const identities = await gitCommitIdentities(args.rootPath, args.commitHash, args.signal);
  const createdCommit = await request(repoPath(args.remote, "/git/commits"), {
    method: "POST",
    body: JSON.stringify({
      message: args.message,
      tree: createdTree.sha,
      parents: [remoteCommitHash],
      ...identities,
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