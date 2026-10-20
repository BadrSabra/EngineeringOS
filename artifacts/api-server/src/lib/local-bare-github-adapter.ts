import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitHubRequest } from "./github-connector.js";

const FIXTURE_OWNER = "fixture";
const FIXTURE_REPO = "engineering-agent-lifecycle";
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

type GitResult = { stdout: Buffer; stderr: Buffer };

function runGit(
  bareRepoPath: string,
  args: string[],
  options: { input?: Buffer; env?: Record<string, string> } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--git-dir", bareRepoPath, ...args], {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new Error("Local GitHub fixture output exceeded its limit."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (code === 0) {
        resolve(result);
        return;
      }
      reject(new Error(result.stderr.toString("utf8").slice(0, 1200) || `git exited ${code}`));
    });
    child.stdin.end(options.input);
  });
}

function parseObjectBody(body: string | undefined): Record<string, unknown> {
  if (!body) return {};
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Local GitHub fixture request body must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function parseCommitIdentity(value: unknown): { name: string; email: string; date: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local GitHub fixture commit identity is missing.");
  }
  const identity = value as Record<string, unknown>;
  const { name, email, date } = identity;
  if (
    typeof name !== "string" || !name.trim() || name.length > 200 || /[\r\n\0]/u.test(name)
    || typeof email !== "string" || !email.trim() || email.length > 320 || /[\r\n\0]/u.test(email)
    || typeof date !== "string" || date.length > 80 || !Number.isFinite(Date.parse(date))
  ) {
    throw new Error("Local GitHub fixture commit identity is invalid.");
  }
  return { name, email, date };
}

function safeBranch(branch: string): string {
  const normalized = branch.split("/").map(decodeURIComponent).join("/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
    || /[\u0000-\u001f~^:?*[\]\\]/u.test(normalized)
  ) {
    throw new Error("Local GitHub fixture branch is invalid.");
  }
  return normalized;
}

function safeTreePath(value: unknown): string {
  if (typeof value !== "string") throw new Error("Local GitHub fixture tree path is invalid.");
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
    || normalized.includes("\0")
  ) {
    throw new Error("Local GitHub fixture tree path is unsafe.");
  }
  return normalized;
}

function requireSha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error("Local GitHub fixture requires a Git SHA-1 object identity.");
  }
  return value;
}

async function objectType(bareRepoPath: string, sha: string): Promise<string> {
  return (await runGit(bareRepoPath, ["cat-file", "-t", requireSha(sha)])).stdout.toString("utf8").trim();
}

export async function createLocalBareGitHubRequest(input: {
  bareRepoPath: string;
  owner?: string;
  repo?: string;
}): Promise<GitHubRequest> {
  if ((input.owner ?? FIXTURE_OWNER) !== FIXTURE_OWNER || (input.repo ?? FIXTURE_REPO) !== FIXTURE_REPO) {
    throw new Error("Local GitHub fixture only accepts its fixed repository identity.");
  }
  if (!path.isAbsolute(input.bareRepoPath)) {
    throw new Error("Local GitHub fixture repository path must be absolute.");
  }
  const bareRepoPath = await realpath(input.bareRepoPath);
  if (!(await stat(bareRepoPath)).isDirectory()) {
    throw new Error("Local GitHub fixture repository is unavailable.");
  }
  let isBare = false;
  try {
    isBare = (await runGit(bareRepoPath, ["rev-parse", "--is-bare-repository"]))
      .stdout.toString("utf8").trim() === "true";
  } catch {
    isBare = false;
  }
  if (!isBare) {
    throw new Error("Local GitHub fixture must use a bare repository.");
  }

  return async (requestPath, init = {}) => {
    const parts = requestPath.split("/").filter(Boolean);
    if (
      parts.length < 5
      || parts[0] !== "repos"
      || decodeURIComponent(parts[1]!) !== FIXTURE_OWNER
      || decodeURIComponent(parts[2]!) !== FIXTURE_REPO
      || parts[3] !== "git"
    ) {
      throw new Error("Local GitHub fixture rejected a request outside its fixed repository.");
    }
    const method = (init.method ?? "GET").toUpperCase();
    const body = parseObjectBody(init.body);

    if (method === "GET" && parts[4] === "ref" && parts[5] === "heads" && parts.length >= 7) {
      const branch = safeBranch(parts.slice(6).join("/"));
      const ref = `refs/heads/${branch}`;
      const sha = (await runGit(bareRepoPath, ["rev-parse", "--verify", ref])).stdout.toString("utf8").trim();
      return { ref, object: { sha, type: "commit" } };
    }

    if (method === "GET" && parts[4] === "commits" && parts.length === 6) {
      const sha = requireSha(parts[5]);
      if (await objectType(bareRepoPath, sha) !== "commit") {
        throw new Error("Local GitHub fixture object is not a commit.");
      }
      const [treeHash, parentsLine, message] = await Promise.all([
        runGit(bareRepoPath, ["rev-parse", `${sha}^{tree}`]).then((result) => result.stdout.toString("utf8").trim()),
        runGit(bareRepoPath, ["rev-list", "--parents", "-n", "1", sha]).then((result) =>
          result.stdout.toString("utf8").trim().split(/\s+/u).slice(1)),
        runGit(bareRepoPath, ["show", "-s", "--format=%B", sha]).then((result) =>
          result.stdout.toString("utf8").trim()),
      ]);
      return { sha, tree: { sha: treeHash }, parents: parentsLine.map((parent) => ({ sha: parent })), message };
    }

    if (method === "POST" && parts[4] === "blobs" && parts.length === 5) {
      const content = body.content;
      if (typeof content !== "string" || content.length > MAX_GIT_OUTPUT_BYTES * 2) {
        throw new Error("Local GitHub fixture blob content is invalid or too large.");
      }
      const bytes = body.encoding === "base64"
        ? Buffer.from(content, "base64")
        : body.encoding === "utf-8" || body.encoding === undefined
          ? Buffer.from(content, "utf8")
          : null;
      if (!bytes || bytes.length > MAX_GIT_OUTPUT_BYTES) {
        throw new Error("Local GitHub fixture blob encoding is unsupported.");
      }
      const sha = (await runGit(bareRepoPath, ["hash-object", "-w", "--stdin"], { input: bytes }))
        .stdout.toString("utf8").trim();
      return { sha };
    }

    if (method === "POST" && parts[4] === "trees" && parts.length === 5) {
      const baseTree = requireSha(body.base_tree);
      if (await objectType(bareRepoPath, baseTree) !== "tree") {
        throw new Error("Local GitHub fixture base tree is invalid.");
      }
      if (!Array.isArray(body.tree) || body.tree.length > 10_000) {
        throw new Error("Local GitHub fixture tree entries are invalid.");
      }
      const entries = body.tree as Array<Record<string, unknown>>;
      const seen = new Set<string>();
      const indexDir = await mkdtemp(path.join(tmpdir(), "engineeringos-github-index-"));
      const indexPath = path.join(indexDir, "index");
      const env = { GIT_INDEX_FILE: indexPath };
      try {
        await runGit(bareRepoPath, ["read-tree", baseTree], { env });
        for (const entry of entries) {
          const entryPath = safeTreePath(entry.path);
          if (seen.has(entryPath) || entry.type !== "blob") {
            throw new Error("Local GitHub fixture tree entry is duplicated or unsupported.");
          }
          seen.add(entryPath);
          if (entry.sha === null) {
            await runGit(bareRepoPath, ["update-index", "--force-remove", "--", entryPath], { env });
            continue;
          }
          const sha = requireSha(entry.sha);
          if (await objectType(bareRepoPath, sha) !== "blob") {
            throw new Error("Local GitHub fixture tree entry does not reference a blob.");
          }
          const mode = entry.mode === "100755" ? "100755" : entry.mode === "100644" ? "100644" : null;
          if (!mode) throw new Error("Local GitHub fixture file mode is unsupported.");
          await runGit(bareRepoPath, ["update-index", "--add", "--cacheinfo", `${mode},${sha},${entryPath}`], { env });
        }
        const sha = (await runGit(bareRepoPath, ["write-tree"], { env })).stdout.toString("utf8").trim();
        return { sha };
      } finally {
        await rm(indexDir, { recursive: true, force: true });
      }
    }

    if (method === "POST" && parts[4] === "commits" && parts.length === 5) {
      const tree = requireSha(body.tree);
      if (await objectType(bareRepoPath, tree) !== "tree") {
        throw new Error("Local GitHub fixture commit tree is invalid.");
      }
      if (!Array.isArray(body.parents) || body.parents.length !== 1) {
        throw new Error("Local GitHub fixture accepts only one-parent commits.");
      }
      const parent = requireSha(body.parents[0]);
      if (await objectType(bareRepoPath, parent) !== "commit") {
        throw new Error("Local GitHub fixture commit parent is invalid.");
      }
      if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 500) {
        throw new Error("Local GitHub fixture commit message is invalid.");
      }
      const author = parseCommitIdentity(body.author);
      const committer = parseCommitIdentity(body.committer);
      const sha = (await runGit(bareRepoPath, ["commit-tree", tree, "-p", parent, "-m", body.message], {
        env: {
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_AUTHOR_DATE: author.date,
          GIT_COMMITTER_NAME: committer.name,
          GIT_COMMITTER_EMAIL: committer.email,
          GIT_COMMITTER_DATE: committer.date,
        },
      })).stdout.toString("utf8").trim();
      return { sha };
    }

    if (method === "PATCH" && parts[4] === "refs" && parts[5] === "heads" && parts.length >= 7) {
      const branch = safeBranch(parts.slice(6).join("/"));
      const ref = `refs/heads/${branch}`;
      const sha = requireSha(body.sha);
      if (body.force !== false) throw new Error("Local GitHub fixture forbids force updates.");
      const before = (await runGit(bareRepoPath, ["rev-parse", "--verify", ref])).stdout.toString("utf8").trim();
      await runGit(bareRepoPath, ["update-ref", ref, sha, before]);
      return { ref, object: { sha, type: "commit" } };
    }

    throw new Error(`Local GitHub fixture rejected unsupported ${method} ${requestPath}.`);
  };
}

export async function createControlledLocalBareGitHubRequest(remoteUrl: string): Promise<GitHubRequest | undefined> {
  const enabled = process.env.RUN_CONTROLLED_RELEASE_VALIDATION === "1"
    && process.env.DASHBOARD_E2E_TEST_MODE === "fixture"
    && process.env.ENGINEERING_AGENT_LIFECYCLE_E2E === "1"
    && process.env.NODE_ENV !== "production";
  if (!enabled) return undefined;
  const remote = new URL(remoteUrl);
  if (
    remote.protocol !== "https:"
    || remote.hostname !== "github.com"
    || remote.username
    || remote.password
    || remote.pathname.replace(/\.git$/u, "") !== `/${FIXTURE_OWNER}/${FIXTURE_REPO}`
  ) {
    throw new Error("Controlled lifecycle delivery accepts only its fixed credential-free GitHub fixture remote.");
  }
  const bareRepoPath = process.env.ENGINEERING_AGENT_LIFECYCLE_REMOTE;
  if (!bareRepoPath) throw new Error("Controlled lifecycle delivery requires an isolated local bare remote.");
  return createLocalBareGitHubRequest({ bareRepoPath });
}
