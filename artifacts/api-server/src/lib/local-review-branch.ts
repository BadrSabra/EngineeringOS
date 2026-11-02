import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { hashDeliveryTree, writeDeliveryWorkspaceFile } from "./delivery-workspace.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_REVIEW_CHANGE_BYTES = 8 * 1024 * 1024;
const MAX_REVIEW_TOTAL_BYTES = 32 * 1024 * 1024;
const MANIFEST_VERSION = 1;

export type LocalReviewChange = {
  path: string;
  originalContent: string | null;
  newContent: string;
};

export type LocalReviewBranchResult = {
  branchName: string;
  worktreePath: string;
  projectRootPath: string;
  sourceCommitSha: string;
  changeSetHash: string;
  candidateTreeHash: string;
  reused: boolean;
};

export class LocalReviewBranchError extends Error {
  readonly code:
    | "LOCAL_REVIEW_SOURCE_INVALID"
    | "LOCAL_REVIEW_SOURCE_MISMATCH"
    | "LOCAL_REVIEW_CHANGESET_INVALID"
    | "LOCAL_REVIEW_FILTERS_UNSAFE"
    | "LOCAL_REVIEW_BRANCH_EXISTS"
    | "LOCAL_REVIEW_BRANCH_INCOMPLETE"
    | "LOCAL_REVIEW_BRANCH_CHANGED"
    | "LOCAL_REVIEW_STORAGE_UNSAFE";

  constructor(
    code: LocalReviewBranchError["code"],
    message: string,
  ) {
    super(message);
    this.name = "LocalReviewBranchError";
    this.code = code;
  }
}

type ReviewManifest = {
  version: number;
  state: "PREPARING" | "READY";
  projectId: string;
  proposalId: string;
  branchName: string;
  worktreePath: string;
  sourceCommitSha: string;
  projectRootRelativePath: string;
  changeSetHash: string;
  candidateTreeHash?: string;
};

type ReviewBranchWorkspaceInput = {
  projectId: string;
  proposalId: string;
  repositoryRootPath: string;
  projectRootRelativePath: string;
  sourceCommitSha: string;
  changes: readonly LocalReviewChange[];
  worktreesRoot?: string;
};

function reviewBranchKey(projectId: string, proposalId: string): string {
  return createHash("sha256")
    .update(`${projectId}\0${proposalId}`)
    .digest("hex")
    .slice(0, 32);
}

async function lstatIfExists(filePath: string) {
  return lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

function safeRelativePath(value: unknown, allowRoot = false): string | null {
  if (allowRoot && (value === "." || value === "")) return ".";
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 1024
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || value.startsWith(":")
  ) return null;

  const segments = value.split("/");
  if (segments.some((segment) =>
    !segment
    || segment === "."
    || segment === ".."
    || segment.toLowerCase() === ".git"
  )) return null;
  return path.posix.normalize(value) === value ? value : null;
}

function sourceProjectPath(projectRootRelativePath: string, relativePath: string): string {
  return projectRootRelativePath === "."
    ? relativePath
    : `${projectRootRelativePath}/${relativePath}`;
}

function gitArgs(args: string[]): string[] {
  // The source repository may contain untrusted hooks. The review branch does
  // not need hooks or a filesystem monitor, so suppress both for every command.
  return ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args];
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...gitArgs(args)], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  return result.stdout.trimEnd();
}

async function runGitPreservingOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...gitArgs(args)], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  return result.stdout;
}

async function optionalGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(cwd, args);
  } catch {
    return null;
  }
}

function normalizeChanges(changes: readonly LocalReviewChange[]): LocalReviewChange[] {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 200) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_CHANGESET_INVALID",
      "The proposal does not contain a bounded reviewable change set.",
    );
  }
  const normalized = changes.map((change) => {
    const relativePath = safeRelativePath(change?.path);
    if (
      !relativePath
      || (change.originalContent !== null && typeof change.originalContent !== "string")
      || typeof change.newContent !== "string"
    ) {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_CHANGESET_INVALID",
        "The proposal contains an unsupported or unsafe file change.",
      );
    }
    const newBytes = Buffer.byteLength(change.newContent, "utf8");
    const originalBytes = change.originalContent === null
      ? 0
      : Buffer.byteLength(change.originalContent, "utf8");
    if (newBytes > MAX_REVIEW_CHANGE_BYTES || originalBytes > MAX_REVIEW_CHANGE_BYTES) {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_CHANGESET_INVALID",
        "A proposal file exceeds the local review size limit.",
      );
    }
    return {
      path: relativePath,
      originalContent: change.originalContent,
      newContent: change.newContent,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));

  if (new Set(normalized.map((change) => change.path)).size !== normalized.length) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_CHANGESET_INVALID",
      "The proposal contains duplicate normalized file paths.",
    );
  }
  const totalBytes = normalized.reduce(
    (sum, change) => sum
      + Buffer.byteLength(change.newContent, "utf8")
      + (change.originalContent === null ? 0 : Buffer.byteLength(change.originalContent, "utf8")),
    0,
  );
  if (totalBytes > MAX_REVIEW_TOTAL_BYTES) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_CHANGESET_INVALID",
      "The proposal exceeds the total local review size limit.",
    );
  }
  return normalized;
}

function hashChanges(changes: readonly LocalReviewChange[]): string {
  return createHash("sha256").update(JSON.stringify(changes)).digest("hex");
}

async function gitTreeEntry(
  repositoryRoot: string,
  commitSha: string,
  relativePath: string,
): Promise<{ mode: string; type: string; objectSha: string } | null> {
  const output = await runGit(repositoryRoot, [
    "ls-tree",
    "-z",
    commitSha,
    "--",
    `:(literal)${relativePath}`,
  ]);
  if (!output) return null;
  const records = output.split("\0").filter(Boolean);
  const matches = records.flatMap((record) => {
    const tab = record.indexOf("\t");
    if (tab < 0 || record.slice(tab + 1) !== relativePath) return [];
    const [mode, type, objectSha] = record.slice(0, tab).split(" ");
    return mode && type && objectSha ? [{ mode, type, objectSha }] : [];
  });
  if (matches.length > 1) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The source commit contains an ambiguous path entry.",
    );
  }
  return matches[0] ?? null;
}

async function assertSourcePathMatches(
  repositoryRoot: string,
  commitSha: string,
  projectRootRelativePath: string,
  change: LocalReviewChange,
): Promise<void> {
  const repoPath = sourceProjectPath(projectRootRelativePath, change.path);
  const segments = repoPath.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join("/");
    const ancestorEntry = await gitTreeEntry(repositoryRoot, commitSha, ancestor);
    if (ancestorEntry && ancestorEntry.type !== "tree") {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_SOURCE_INVALID",
        "A proposal path traverses a non-directory source entry.",
      );
    }
  }
  const entry = await gitTreeEntry(repositoryRoot, commitSha, repoPath);
  if (!entry) {
    if (change.originalContent !== null) {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_SOURCE_MISMATCH",
        "A proposal base file is absent from its recorded source commit.",
      );
    }
    return;
  }
  if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "Review branches do not accept symlinks, submodules, or non-regular source files.",
    );
  }
  if (change.originalContent === null) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_MISMATCH",
      "A proposal marks a source file as new, but that path already exists.",
    );
  }
  const sourceBytes = await runGitPreservingOutput(repositoryRoot, ["cat-file", "blob", entry.objectSha]);
  if (!Buffer.from(sourceBytes, "utf8").equals(Buffer.from(change.originalContent, "utf8"))) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_MISMATCH",
      "A proposal base file does not match its recorded source commit.",
    );
  }
}

async function configuredFilters(repositoryRoot: string): Promise<boolean> {
  const filters = await optionalGit(repositoryRoot, [
    "config",
    "--local",
    "--get-regexp",
    "^filter\\..*\\.(clean|smudge|process)$",
  ]);
  return Boolean(filters?.trim());
}

function assertSha(value: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "A full Git source commit SHA is required.",
    );
  }
}

function assertContained(parent: string, child: string): void {
  const relative = path.relative(parent, child);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_STORAGE_UNSAFE",
      "The review worktree path is outside its managed storage root.",
    );
  }
}

async function assertReadyWorktree(params: {
  manifest: ReviewManifest;
  changes: readonly LocalReviewChange[];
  manifestPath: string;
}): Promise<LocalReviewBranchResult> {
  const { manifest, changes, manifestPath } = params;
  if (
    manifest.version !== MANIFEST_VERSION
    || manifest.state !== "READY"
    || manifest.sourceCommitSha.length < 40
    || manifest.changeSetHash !== hashChanges(changes)
  ) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_INCOMPLETE",
      "An earlier local review branch attempt is incomplete or belongs to another proposal.",
    );
  }
  const actualPath = await realpath(manifest.worktreePath).catch(() => null);
  if (!actualPath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_INCOMPLETE",
      "The recorded local review worktree is no longer available.",
    );
  }
  const [head, branch] = await Promise.all([
    runGit(actualPath, ["rev-parse", "--verify", "HEAD^{commit}"]),
    runGit(actualPath, ["branch", "--show-current"]),
  ]);
  if (head.trim() !== manifest.sourceCommitSha || branch.trim() !== manifest.branchName) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_CHANGED",
      "The existing review branch no longer matches its recorded source identity.",
    );
  }
  const projectRootPath = path.resolve(actualPath, manifest.projectRootRelativePath);
  const actualProjectRoot = await realpath(projectRootPath).catch(() => null);
  if (!actualProjectRoot || !actualProjectRoot.startsWith(`${actualPath}${path.sep}`) && actualProjectRoot !== actualPath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_CHANGED",
      "The review project root is unavailable or escapes its worktree.",
    );
  }
  for (const change of changes) {
    const segments = change.path.split("/");
    let target = actualProjectRoot;
    let stat;
    for (const segment of segments) {
      target = path.join(target, segment);
      stat = await lstat(target).catch(() => null);
      if (stat?.isSymbolicLink()) {
        throw new LocalReviewBranchError(
          "LOCAL_REVIEW_BRANCH_CHANGED",
          "A reviewed candidate path now traverses a symbolic link; it was preserved.",
        );
      }
    }
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_BRANCH_CHANGED",
        "A reviewed candidate file was removed or replaced with a non-file.",
      );
    }
    const bytes = await readFile(target);
    if (!bytes.equals(Buffer.from(change.newContent, "utf8"))) {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_BRANCH_CHANGED",
        "A reviewed candidate file was edited after branch creation; it was preserved.",
      );
    }
  }
  const candidateTreeHash = await hashDeliveryTree(actualProjectRoot);
  if (!manifest.candidateTreeHash || candidateTreeHash !== manifest.candidateTreeHash) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_CHANGED",
      "The review worktree changed after creation; it was preserved and not overwritten.",
    );
  }
  // Re-read the sidecar so an untrusted or concurrent edit cannot make this
  // retry silently adopt a manifest that differs from the one just validated.
  const persisted = JSON.parse(await readFile(manifestPath, "utf8")) as ReviewManifest;
  if (JSON.stringify(persisted) !== JSON.stringify(manifest)) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_CHANGED",
      "The local review marker changed during verification.",
    );
  }
  return {
    branchName: manifest.branchName,
    worktreePath: actualPath,
    projectRootPath: actualProjectRoot,
    sourceCommitSha: manifest.sourceCommitSha,
    changeSetHash: manifest.changeSetHash,
    candidateTreeHash,
    reused: true,
  };
}

export function localReviewWorktreesRoot(): string {
  const workspaceRoot = path.resolve(process.env.WORKSPACE_PATH ?? process.cwd());
  return path.join(workspaceRoot, ".local", "engineeringos-review-worktrees");
}

/**
 * Read and revalidate an existing review worktree without creating directories,
 * branches, manifests, or candidate files. This is used to rehydrate the UI
 * after navigation/reload and intentionally fails closed when local state has
 * changed or is incomplete.
 */
export async function inspectLocalReviewBranchWorkspace(
  input: ReviewBranchWorkspaceInput,
): Promise<LocalReviewBranchResult | null> {
  assertSha(input.sourceCommitSha);
  const sourceCommitSha = input.sourceCommitSha.toLowerCase();
  const projectRootRelativePath = safeRelativePath(input.projectRootRelativePath, true);
  if (!projectRootRelativePath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The recorded project root path is invalid.",
    );
  }
  if (!/^[a-f0-9-]{36}$/i.test(input.projectId) || !/^[a-f0-9-]{36}$/i.test(input.proposalId)) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_CHANGESET_INVALID",
      "Project and proposal identities must be server-generated UUIDs.",
    );
  }
  const changes = normalizeChanges(input.changes);
  const changeSetHash = hashChanges(changes);
  const repositoryRootPath = await realpath(input.repositoryRootPath).catch(() => null);
  if (!repositoryRootPath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The registered source repository is unavailable.",
    );
  }
  const discoveredRoot = await runGit(repositoryRootPath, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = await realpath(discoveredRoot.trim());
  const resolvedProjectRoot = await realpath(input.repositoryRootPath);
  const currentRelativeRoot = path.relative(repositoryRoot, resolvedProjectRoot);
  const currentProjectRootRelativePath = currentRelativeRoot === ""
    ? "."
    : currentRelativeRoot.split(path.sep).join("/");
  if (currentProjectRootRelativePath !== projectRootRelativePath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_MISMATCH",
      "The registered project root no longer matches the path bound to the proposal.",
    );
  }
  if ((await optionalGit(repositoryRoot, ["cat-file", "-t", sourceCommitSha]))?.trim() !== "commit") {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The recorded source commit is not available as a commit object in the local repository.",
    );
  }
  for (const change of changes) {
    await assertSourcePathMatches(repositoryRoot, sourceCommitSha, projectRootRelativePath, change);
  }

  const worktreesRoot = path.resolve(input.worktreesRoot ?? localReviewWorktreesRoot());
  const rootStat = await lstatIfExists(worktreesRoot);
  if (!rootStat) return null;
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_STORAGE_UNSAFE",
      "The review storage root is not a regular directory.",
    );
  }
  const canonicalWorktreesRoot = await realpath(worktreesRoot);
  if (canonicalWorktreesRoot !== worktreesRoot) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_STORAGE_UNSAFE",
      "The review storage root resolves through a symbolic link.",
    );
  }
  const key = reviewBranchKey(input.projectId, input.proposalId);
  const operationRoot = path.join(canonicalWorktreesRoot, key);
  assertContained(canonicalWorktreesRoot, operationRoot);
  const operationStat = await lstatIfExists(operationRoot);
  if (!operationStat) return null;
  if (!operationStat.isDirectory() || operationStat.isSymbolicLink()) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_STORAGE_UNSAFE",
      "The local review operation root is not a regular directory.",
    );
  }
  const canonicalOperationRoot = await realpath(operationRoot);
  assertContained(canonicalWorktreesRoot, canonicalOperationRoot);
  const manifestPath = path.join(canonicalOperationRoot, "manifest.json");
  const manifestStat = await lstatIfExists(manifestPath);
  if (!manifestStat) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_INCOMPLETE",
      "A local review operation exists without its manifest; it was preserved.",
    );
  }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_STORAGE_UNSAFE",
      "The local review marker is not a regular file.",
    );
  }
  let manifest: ReviewManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ReviewManifest;
  } catch {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_INCOMPLETE",
      "The local review marker is unreadable; the branch was preserved.",
    );
  }
  const expectedBranchName = `eos/review/${key}`;
  const expectedWorktreePath = path.join(canonicalOperationRoot, "worktree");
  if (
    manifest.projectId !== input.projectId
    || manifest.proposalId !== input.proposalId
    || manifest.branchName !== expectedBranchName
    || manifest.worktreePath !== expectedWorktreePath
    || manifest.sourceCommitSha !== sourceCommitSha
    || manifest.projectRootRelativePath !== projectRootRelativePath
    || manifest.changeSetHash !== changeSetHash
  ) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_EXISTS",
      "The recorded local review worktree belongs to a different proposal identity; it was preserved.",
    );
  }
  const worktreeStat = await lstatIfExists(expectedWorktreePath);
  if (!worktreeStat || !worktreeStat.isDirectory() || worktreeStat.isSymbolicLink()) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_INCOMPLETE",
      "The recorded local review worktree is unavailable or unsafe.",
    );
  }
  const canonicalWorktreePath = await realpath(expectedWorktreePath);
  assertContained(canonicalWorktreesRoot, canonicalWorktreePath);
  return assertReadyWorktree({ manifest, changes, manifestPath });
}

/**
 * Create a branch and isolated worktree from the exact clean source commit
 * bound to a proposal. It never applies changes to the registered live root,
 * creates a commit, or contacts a remote. Retries are read-only and refuse to
 * overwrite a branch that a reviewer has changed.
 */
export async function createLocalReviewBranchWorkspace(
  input: ReviewBranchWorkspaceInput,
): Promise<LocalReviewBranchResult> {
  assertSha(input.sourceCommitSha);
  const sourceCommitSha = input.sourceCommitSha.toLowerCase();
  const projectRootRelativePath = safeRelativePath(input.projectRootRelativePath, true);
  if (!projectRootRelativePath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The recorded project root path is invalid.",
    );
  }
  if (!/^[a-f0-9-]{36}$/i.test(input.projectId) || !/^[a-f0-9-]{36}$/i.test(input.proposalId)) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_CHANGESET_INVALID",
      "Project and proposal identities must be server-generated UUIDs.",
    );
  }
  const changes = normalizeChanges(input.changes);
  const changeSetHash = hashChanges(changes);
  const repositoryRootPath = await realpath(input.repositoryRootPath).catch(() => null);
  if (!repositoryRootPath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The registered source repository is unavailable.",
    );
  }
  const discoveredRoot = await runGit(repositoryRootPath, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = await realpath(discoveredRoot.trim());
  const resolvedProjectRoot = await realpath(input.repositoryRootPath);
  const currentRelativeRoot = path.relative(repositoryRoot, resolvedProjectRoot);
  const currentProjectRootRelativePath = currentRelativeRoot === ""
    ? "."
    : currentRelativeRoot.split(path.sep).join("/");
  if (currentProjectRootRelativePath !== projectRootRelativePath) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_MISMATCH",
      "The registered project root no longer matches the path bound to the proposal.",
    );
  }
  if (await configuredFilters(repositoryRoot)) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_FILTERS_UNSAFE",
      "The repository has configured Git filters; creating a review worktree could execute external filter commands.",
    );
  }
  const sourceType = await optionalGit(repositoryRoot, [
    "cat-file",
    "-t",
    sourceCommitSha,
  ]);
  if (sourceType?.trim() !== "commit") {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The recorded source commit is not available as a commit object in the local repository.",
    );
  }
  for (const change of changes) {
    await assertSourcePathMatches(
      repositoryRoot,
      sourceCommitSha,
      projectRootRelativePath,
      change,
    );
  }

  const worktreesRoot = path.resolve(input.worktreesRoot ?? localReviewWorktreesRoot());
  await mkdir(worktreesRoot, { recursive: true });
  const canonicalWorktreesRoot = await realpath(worktreesRoot);
  if (canonicalWorktreesRoot !== worktreesRoot) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_STORAGE_UNSAFE",
      "The review storage root resolves through a symbolic link.",
    );
  }
  const key = reviewBranchKey(input.projectId, input.proposalId);
  const branchName = `eos/review/${key}`;
  const operationRoot = path.join(canonicalWorktreesRoot, key);
  const worktreePath = path.join(operationRoot, "worktree");
  const manifestPath = path.join(operationRoot, "manifest.json");
  assertContained(canonicalWorktreesRoot, operationRoot);
  await mkdir(operationRoot, { recursive: true });
  const canonicalOperationRoot = await realpath(operationRoot);
  assertContained(canonicalWorktreesRoot, canonicalOperationRoot);

  const existingManifestStat = await lstat(manifestPath).catch(() => null);
  if (existingManifestStat) {
    if (!existingManifestStat.isFile() || existingManifestStat.isSymbolicLink()) {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_STORAGE_UNSAFE",
        "The local review marker is not a regular file.",
      );
    }
    let manifest: ReviewManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ReviewManifest;
    } catch {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_BRANCH_INCOMPLETE",
        "The local review marker is unreadable; the branch was preserved.",
      );
    }
    if (
      manifest.projectId !== input.projectId
      || manifest.proposalId !== input.proposalId
      || manifest.branchName !== branchName
      || manifest.worktreePath !== worktreePath
      || manifest.sourceCommitSha !== sourceCommitSha
      || manifest.projectRootRelativePath !== projectRootRelativePath
      || manifest.changeSetHash !== changeSetHash
    ) {
      throw new LocalReviewBranchError(
        "LOCAL_REVIEW_BRANCH_EXISTS",
        "A local review branch already exists with a different identity; it was not changed.",
      );
    }
    return assertReadyWorktree({
      manifest,
      changes,
      manifestPath,
    });
  }

  const targetExists = await lstat(worktreePath).then(() => true).catch(() => false);
  const branchExists = await optionalGit(repositoryRoot, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]) !== null;
  if (targetExists || branchExists) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_BRANCH_EXISTS",
      "A branch or worktree already uses this review identity; it was not overwritten.",
    );
  }

  const manifest: ReviewManifest = {
    version: MANIFEST_VERSION,
    state: "PREPARING",
    projectId: input.projectId,
    proposalId: input.proposalId,
    branchName,
    worktreePath,
    sourceCommitSha,
    projectRootRelativePath,
    changeSetHash,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

  await runGit(repositoryRoot, [
    "worktree",
    "add",
    "-b",
    branchName,
    worktreePath,
    sourceCommitSha,
  ]);
  const actualWorktreeRoot = await realpath(worktreePath);
  assertContained(canonicalWorktreesRoot, actualWorktreeRoot);
  const candidateProjectRoot = projectRootRelativePath === "."
    ? actualWorktreeRoot
    : path.resolve(actualWorktreeRoot, projectRootRelativePath);
  const resolvedCandidateProjectRoot = await realpath(candidateProjectRoot).catch(() => null);
  if (
    !resolvedCandidateProjectRoot
    || (resolvedCandidateProjectRoot !== actualWorktreeRoot
      && !resolvedCandidateProjectRoot.startsWith(`${actualWorktreeRoot}${path.sep}`))
  ) {
    throw new LocalReviewBranchError(
      "LOCAL_REVIEW_SOURCE_INVALID",
      "The project root in the recorded source commit is missing or escapes the worktree.",
    );
  }
  for (const change of changes) {
    await writeDeliveryWorkspaceFile(
      resolvedCandidateProjectRoot,
      change.path,
      change.newContent,
    );
  }
  const candidateTreeHash = await hashDeliveryTree(resolvedCandidateProjectRoot);
  const readyManifest: ReviewManifest = {
    ...manifest,
    state: "READY",
    candidateTreeHash,
  };
  const tempManifestPath = `${manifestPath}.tmp`;
  await writeFile(tempManifestPath, `${JSON.stringify(readyManifest)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await rename(tempManifestPath, manifestPath);

  return {
    branchName,
    worktreePath: actualWorktreeRoot,
    projectRootPath: resolvedCandidateProjectRoot,
    sourceCommitSha,
    changeSetHash,
    candidateTreeHash,
    reused: false,
  };
}
