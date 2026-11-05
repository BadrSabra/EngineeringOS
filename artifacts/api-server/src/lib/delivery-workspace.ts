import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants, type BigIntStats } from "node:fs";
import {
  cp,
  link,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
  readdir,
  lstat,
  readlink,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Return HEAD only when the project root is inside a real Git worktree and
 * the index/worktree/untracked files are clean. This is provenance metadata,
 * not a filesystem lock: callers must recheck before binding it to a proposal.
 */
export type CleanGitSourceIdentity = {
  commitSha: string;
  projectRootRelativePath: string;
};

export async function captureCleanGitSourceCommitSha(
  rootPath: string,
): Promise<CleanGitSourceIdentity | null> {
  try {
    const resolvedRoot = await realpath(rootPath);
    const gitRootOutput = await execFileAsync(
      "git",
      ["-C", resolvedRoot, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 },
    );
    const gitRoot = await realpath(gitRootOutput.stdout.trim());
    const relativeRoot = path.relative(gitRoot, resolvedRoot);
    if (
      path.isAbsolute(relativeRoot)
      || relativeRoot === ".."
      || relativeRoot.startsWith(`..${path.sep}`)
    ) {
      return null;
    }

    const [headOutput, statusOutput] = await Promise.all([
      execFileAsync(
        "git",
        ["-C", resolvedRoot, "rev-parse", "--verify", "HEAD^{commit}"],
        { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 },
      ),
      execFileAsync(
        "git",
        ["-C", resolvedRoot, "status", "--porcelain=v1", "--untracked-files=all"],
        { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 },
      ),
    ]);
    const head = headOutput.stdout.trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(head) || statusOutput.stdout.trim() !== "") {
      return null;
    }
    return {
      commitSha: head.toLowerCase(),
      projectRootRelativePath: relativeRoot === ""
        ? "."
        : relativeRoot.split(path.sep).join("/"),
    };
  } catch {
    // Non-Git roots, missing HEADs, or Git inspection failures are not branchable.
    return null;
  }
}

export type DeliveryLifecycle =
  | "proposed" | "isolated" | "validated" | "applied" | "conflicted"
  | "committed" | "cancelled" | "abandoned" | "blocked";

export class DeliveryPromotionConflictError extends Error {
  readonly code = "DELIVERY_TARGET_CHANGED";

  constructor() {
    super("The live target changed after validation; promotion or recovery was stopped.");
    this.name = "DeliveryPromotionConflictError";
  }
}

async function readOptionalFile(target: string): Promise<Buffer | null> {
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function asBuffer(value: Buffer | string | null): Buffer | null {
  if (value === null) return null;
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

/**
 * Replace one file without exposing truncated bytes. When expectedCurrent is
 * supplied, re-read the target immediately before promotion. A new file uses
 * link(2) so a concurrent creator cannot be overwritten. POSIX rename has no
 * compare-and-swap form for existing files, so callers must also serialize
 * application-owned writes; an uncooperative external writer can still race
 * the final read/rename pair.
 */
export async function atomicallyPromoteFile(
  target: string,
  content: string | Buffer,
  operationId: string,
  precondition?: { expectedCurrent: Buffer | string | null },
): Promise<void> {
  const temp = `${target}.engineeringos-promotion-${operationId}-${process.pid}-${randomUUID()}`;
  await writeFile(temp, content, { mode: 0o600 });
  try {
    if (precondition) {
      const expected = asBuffer(precondition.expectedCurrent);
      const current = await readOptionalFile(target);
      if (
        expected === null
          ? current !== null
          : current === null || !current.equals(expected)
      ) {
        throw new DeliveryPromotionConflictError();
      }

      if (expected === null) {
        try {
          await link(temp, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new DeliveryPromotionConflictError();
          }
          throw error;
        }
        await rm(temp, { force: true });
        return;
      }
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Remove a file only when its bytes still match the expected value. This is a
 * last-moment guard, not an OS-level CAS; callers must treat a mismatch as a
 * recovery conflict and preserve the current file.
 */
export async function removeFileIfUnchanged(
  target: string,
  expectedCurrent: Buffer | string,
): Promise<void> {
  const expected = asBuffer(expectedCurrent);
  const current = await readOptionalFile(target);
  if (!expected || !current?.equals(expected)) {
    throw new DeliveryPromotionConflictError();
  }
  await unlink(target);
}

export type PromotionRecoveryResult = "PROMOTED" | "ROLLED_BACK" | "RECOVERY_REQUIRED";

/** Versioned contract for every candidate and live-root content digest. */
export const DELIVERY_TREE_DIGEST_VERSION = "delivery-tree-v1";
export const DELIVERY_TREE_EXCLUSIONS = [
  ".git",
  "node_modules",
  ".engineeringos-delivery",
  ".engineeringos-projects",
  ".agents",
  ".local",
  ".X11-unix",
] as const;

export type DeliveryTreeDigestErrorCode =
  | "DELIVERY_TREE_ROOT_UNAVAILABLE"
  | "DELIVERY_TREE_ENTRY_UNREADABLE"
  | "DELIVERY_TREE_UNSAFE_PATH"
  | "DELIVERY_TREE_CHANGED_DURING_SCAN";

export class DeliveryTreeDigestError extends Error {
  readonly code: DeliveryTreeDigestErrorCode;

  constructor(code: DeliveryTreeDigestErrorCode, message: string) {
    super(message);
    this.name = "DeliveryTreeDigestError";
    this.code = code;
  }
}

const DIRECTORY_OPEN_FLAGS =
  fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
const FILE_READ_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

function descriptorPath(directory: FileHandle, name?: string): string {
  const base = `/proc/self/fd/${directory.fd}`;
  return name ? path.join(base, name) : base;
}

function sameNodeIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameStableMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return sameNodeIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.nlink === right.nlink;
}

async function openAbsoluteDirectoryNoFollow(absolutePath: string): Promise<FileHandle> {
  const resolved = path.resolve(absolutePath);
  if (!path.isAbsolute(resolved)) throw new Error("An absolute directory path is required.");

  let current = await open(path.parse(resolved).root, DIRECTORY_OPEN_FLAGS);
  try {
    const segments = resolved.slice(path.parse(resolved).root.length)
      .split(path.sep)
      .filter(Boolean);
    for (const segment of segments) {
      const next = await open(descriptorPath(current, segment), DIRECTORY_OPEN_FLAGS);
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Reconcile an interrupted promotion from durable candidate bytes. A live file
 * may be either its recorded base bytes or the exact candidate bytes. Any
 * third value means a user/process changed the root and must be reviewed.
 */
export async function recoverPromotion(params: {
  rootPath: string;
  changes: readonly { path: string; newContent: string; originalContent?: string | null }[];
  operationId: string;
}): Promise<PromotionRecoveryResult> {
  let rootPath: string;
  try {
    rootPath = await realpath(params.rootPath);
  } catch {
    return "RECOVERY_REQUIRED";
  }
  const targetIsSafe = async (target: string): Promise<boolean> => {
    const relativePath = path.relative(rootPath, target);
    if (
      !relativePath
      || path.isAbsolute(relativePath)
      || relativePath === ".."
      || relativePath.startsWith(`..${path.sep}`)
    ) return false;
    const segments = relativePath.split(path.sep);
    let cursor = rootPath;
    for (let index = 0; index < segments.length; index++) {
      cursor = path.join(cursor, segments[index]!);
      try {
        const entry = await lstat(cursor);
        if (entry.isSymbolicLink()) return false;
        if (index < segments.length - 1 && !entry.isDirectory()) return false;
        if (index === segments.length - 1 && !entry.isFile()) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
      }
    }
    return true;
  };

  let changed = false;
  for (const change of params.changes) {
    const target = path.resolve(rootPath, change.path);
    if (
      target === rootPath
      || !target.startsWith(`${rootPath}${path.sep}`)
      || !(await targetIsSafe(target))
    ) {
      return "RECOVERY_REQUIRED";
    }
    let current: string | null = null;
    try {
      current = await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "RECOVERY_REQUIRED";
    }
    const expected = change.newContent;
    const base = change.originalContent ?? null;
    if (current === expected) {
      changed = true;
      continue;
    }
    if (current !== base) return "RECOVERY_REQUIRED";
    await mkdir(path.dirname(target), { recursive: true });
    if (!(await targetIsSafe(target))) return "RECOVERY_REQUIRED";
    const realParent = await realpath(path.dirname(target)).catch(() => null);
    if (
      !realParent
      || (realParent !== rootPath && !realParent.startsWith(`${rootPath}${path.sep}`))
    ) return "RECOVERY_REQUIRED";
    await atomicallyPromoteFile(target, expected, params.operationId, {
      expectedCurrent: current,
    });
    changed = true;
  }
  return changed ? "PROMOTED" : "ROLLED_BACK";
}

export type DeliveryWorkspace = {
  operationId: string;
  rootPath: string;
  workspaceRoot: string;
  baseRevision: string;
  changeSetHash: string;
  baseTreeHash: string;
  candidateTreeHash: string;
  lifecycle: DeliveryLifecycle;
};

const WORKSPACES_DIR = path.join(
  process.env.WORKSPACE_PATH ?? "/home/runner/workspace",
  ".engineeringos-delivery",
);
const MARKER = ".engineeringos-delivery-workspace";

export function hashChangeSet(changes: readonly { path: string; newContent: string }[]): string {
  const canonical = [...changes]
    .map((change) => ({ path: change.path.replaceAll("\\", "/"), newContent: change.newContent }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Runtime sockets, generated delivery state, and toolchain directories are
 * excluded identically while copying and hashing. Keep this policy in one
 * place: a candidate digest must be comparable with a live-root digest.
 */
export function shouldExcludeDeliveryEntry(absolutePath: string, rootPath: string): boolean {
  const basename = path.basename(absolutePath);
  const relative = path.relative(rootPath, absolutePath).replaceAll("\\", "/");
  if (
    absolutePath === rootPath
    || absolutePath.endsWith(".pipe")
    || absolutePath.endsWith(".sock")
    || basename.startsWith(".org.chromium.")
    || /^(?:SingletonSocket|SingletonCookie|SingletonLock)$/.test(basename)
  ) return absolutePath !== rootPath;
  if (relative === ".engineeringos-delivery" || relative.startsWith(".engineeringos-delivery/")) return true;
  return DELIVERY_TREE_EXCLUSIONS.includes(basename as typeof DELIVERY_TREE_EXCLUSIONS[number]);
}

function normalizeDeliveryRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || path.isAbsolute(relativePath)
    || normalized.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new DeliveryTreeDigestError("DELIVERY_TREE_UNSAFE_PATH", "Delivery tree contains an unsafe relative path.");
  }
  return normalized;
}

/**
 * Hash a complete source/candidate tree with a deterministic, byte-oriented
 * record format. Directories are retained (including empty directories),
 * regular files use base64 of their exact bytes, and symlinks use base64 of
 * their link target without following it. Other filesystem kinds are recorded
 * by kind but never read as files.
 */
export type DeliveryTreeHashOptions = {
  /** Internal coordination hook used by deterministic filesystem tests. */
  beforeFileRead?: (relativePath: string) => Promise<void>;
};

export async function hashDeliveryTree(
  rootPath: string,
  options: DeliveryTreeHashOptions = {},
): Promise<string> {
  const resolvedRoot = path.resolve(rootPath);
  const entries: Array<{ path: string; kind: "directory" | "file" | "symlink" | "other"; bytes?: string }> = [];
  const seenPaths = new Set<string>();
  const changedDuringScan = () => new DeliveryTreeDigestError(
    "DELIVERY_TREE_CHANGED_DURING_SCAN",
    "Delivery tree changed while its digest was being computed.",
  );
  const mapEntryError = (error: unknown): DeliveryTreeDigestError => {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ELOOP" || code === "ENOTDIR" || code === "ESTALE") {
      return changedDuringScan();
    }
    return new DeliveryTreeDigestError(
      "DELIVERY_TREE_ENTRY_UNREADABLE",
      "Delivery tree entry could not be read.",
    );
  };

  async function visit(directoryHandle: FileHandle, relativeDirectory: string): Promise<void> {
    let beforeDirectory: BigIntStats;
    let children;
    try {
      beforeDirectory = await directoryHandle.stat({ bigint: true });
      children = (await readdir(descriptorPath(directoryHandle), { withFileTypes: true }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      throw mapEntryError(error);
    }
    for (const entry of children) {
      const relative = normalizeDeliveryRelativePath(
        relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
      );
      const absolute = path.join(resolvedRoot, ...relative.split("/"));
      if (shouldExcludeDeliveryEntry(absolute, resolvedRoot) || (!relativeDirectory && entry.name === MARKER)) continue;
      if (seenPaths.has(relative)) {
        throw new DeliveryTreeDigestError("DELIVERY_TREE_UNSAFE_PATH", "Delivery tree contains duplicate normalized paths.");
      }
      seenPaths.add(relative);
      const anchoredPath = descriptorPath(directoryHandle, entry.name);
      let entryStat: BigIntStats;
      try {
        entryStat = await lstat(anchoredPath, { bigint: true });
      } catch (error) {
        throw mapEntryError(error);
      }
      if (entryStat.isDirectory()) {
        entries.push({ path: relative, kind: "directory" });
        let childDirectory: FileHandle | undefined;
        try {
          childDirectory = await open(anchoredPath, DIRECTORY_OPEN_FLAGS);
          const openedStat = await childDirectory.stat({ bigint: true });
          if (!sameNodeIdentity(entryStat, openedStat)) throw changedDuringScan();
          await visit(childDirectory, relative);
        } catch (error) {
          if (error instanceof DeliveryTreeDigestError) throw error;
          throw mapEntryError(error);
        } finally {
          if (childDirectory) {
            await childDirectory.close().catch(() => undefined);
          }
        }
      } else if (entryStat.isFile()) {
        let fileHandle: FileHandle | undefined;
        try {
          fileHandle = await open(anchoredPath, FILE_READ_FLAGS);
          const openedStat = await fileHandle.stat({ bigint: true });
          if (!sameNodeIdentity(entryStat, openedStat)) throw changedDuringScan();
          await options.beforeFileRead?.(relative);
          const bytes = await fileHandle.readFile();
          const afterReadStat = await fileHandle.stat({ bigint: true });
          if (!sameStableMetadata(openedStat, afterReadStat)) throw changedDuringScan();
          entries.push({ path: relative, kind: "file", bytes: bytes.toString("base64") });
        } catch (error) {
          if (error instanceof DeliveryTreeDigestError) throw error;
          throw mapEntryError(error);
        } finally {
          if (fileHandle) {
            await fileHandle.close().catch(() => undefined);
          }
        }
      } else if (entryStat.isSymbolicLink()) {
        try {
          const target = await readlink(anchoredPath);
          const afterReadStat = await lstat(anchoredPath, { bigint: true });
          if (!sameStableMetadata(entryStat, afterReadStat)) throw changedDuringScan();
          entries.push({ path: relative, kind: "symlink", bytes: Buffer.from(target, "utf8").toString("base64") });
        } catch (error) {
          if (error instanceof DeliveryTreeDigestError) throw error;
          throw mapEntryError(error);
        }
      } else {
        entries.push({ path: relative, kind: "other" });
      }
    }
    let afterDirectory: BigIntStats;
    try {
      afterDirectory = await directoryHandle.stat({ bigint: true });
    } catch (error) {
      throw mapEntryError(error);
    }
    if (!sameStableMetadata(beforeDirectory, afterDirectory)) throw changedDuringScan();
  }

  let rootHandle: FileHandle | undefined;
  let rootStat: BigIntStats;
  try {
    rootHandle = await openAbsoluteDirectoryNoFollow(resolvedRoot);
    rootStat = await rootHandle.stat({ bigint: true });
    if (!rootStat.isDirectory()) throw new Error("not a directory");
  } catch {
    await rootHandle?.close().catch(() => undefined);
    throw new DeliveryTreeDigestError("DELIVERY_TREE_ROOT_UNAVAILABLE", "Delivery tree root is unavailable.");
  }
  try {
    await visit(rootHandle, "");
    let currentRootHandle: FileHandle;
    try {
      currentRootHandle = await openAbsoluteDirectoryNoFollow(resolvedRoot);
    } catch {
      throw changedDuringScan();
    }
    try {
      const currentRootStat = await currentRootHandle.stat({ bigint: true });
      if (!sameNodeIdentity(rootStat, currentRootStat)) throw changedDuringScan();
    } finally {
      await currentRootHandle.close().catch(() => undefined);
    }
    const canonical = JSON.stringify({ version: DELIVERY_TREE_DIGEST_VERSION, entries });
    return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex");
  } finally {
    await rootHandle?.close().catch(() => undefined);
  }
}

export const WORKSPACE_TREE_REVISION_PREFIX = "workspace-tree-v1:";

export async function resolveWorkspaceTreeRevision(rootPath: string): Promise<string> {
  return `${WORKSPACE_TREE_REVISION_PREFIX}${await hashDeliveryTree(rootPath)}`;
}

/** Backward-compatible name used by benchmark and recovery callers. */
export const hashDeliveryWorkspace = hashDeliveryTree;

export async function hashDeliveryFiles(
  rootPath: string,
  changes: readonly { path: string }[],
): Promise<string> {
  const entries = await Promise.all([...changes]
    .map((change) => change.path.replaceAll("\\", "/"))
    .sort((a, b) => a.localeCompare(b))
    .map(async (relative) => ({
      path: relative,
      newContent: (await readFile(path.resolve(rootPath, relative))).toString(),
    })));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function deliveryWorkspacePath(operationId: string): string {
  // Operation identities are server-owned opaque text values. Most production
  // operations are UUIDs, but durable recovery fixtures and imported execution
  // identities may use a prefixed value. Keep the workspace path safe without
  // coupling it to one identifier format.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(operationId)) {
    throw new Error("Invalid delivery operation identity");
  }
  return path.join(WORKSPACES_DIR, operationId);
}

export async function writeDeliveryWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
  options: { afterParentPinned?: () => Promise<void> } = {},
): Promise<void> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const normalized = normalizeDeliveryRelativePath(relativePath);
  const operationId = path.basename(resolvedRoot);
  if (resolvedRoot !== deliveryWorkspacePath(operationId)) {
    throw new Error("Delivery change is not inside its operation-owned workspace");
  }
  const target = path.resolve(resolvedRoot, normalized);
  if (target === resolvedRoot || !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Delivery change escapes isolated workspace");
  }

  let rootHandle: FileHandle | undefined;
  let parentHandle: FileHandle | undefined;
  let temporaryPath: string | undefined;
  try {
    rootHandle = await openAbsoluteDirectoryNoFollow(resolvedRoot);
    parentHandle = rootHandle;

    let markerHandle: FileHandle | undefined;
    try {
      markerHandle = await open(descriptorPath(rootHandle, MARKER), FILE_READ_FLAGS);
      if (await markerHandle.readFile("utf8") !== `${operationId}\n`) {
        throw new Error("Delivery workspace ownership marker does not match");
      }
    } finally {
      await markerHandle?.close().catch(() => undefined);
    }

    const segments = normalized.split("/");
    const fileName = segments.pop();
    if (!fileName) throw new Error("Delivery change has no file name");
    for (const segment of segments) {
      const childPath = descriptorPath(parentHandle, segment);
      try {
        await mkdir(childPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      let next: FileHandle;
      try {
        next = await open(childPath, DIRECTORY_OPEN_FLAGS);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ELOOP" || code === "ENOTDIR") {
          throw new Error("Delivery change traverses a symbolic link or non-directory component");
        }
        throw error;
      }
      if (parentHandle !== rootHandle) {
        await parentHandle.close();
      }
      parentHandle = next;
    }

    await options.afterParentPinned?.();
    const targetPath = descriptorPath(parentHandle, fileName);
    let targetMode: number;
    try {
      const targetStat = await lstat(targetPath, { bigint: true });
      if (targetStat.isSymbolicLink()) {
        throw new Error("Delivery change targets a symbolic link");
      }
      if (!targetStat.isFile()) {
        throw new Error("Delivery change target is not a regular file");
      }
      targetMode = Number(targetStat.mode & 0o777n);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      targetMode = 0o666 & ~process.umask();
    }

    const temporaryName = `.${fileName}.engineeringos-${randomUUID()}.tmp`;
    temporaryPath = descriptorPath(parentHandle, temporaryName);
    const temporaryHandle = await open(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      await temporaryHandle.chmod(targetMode);
      await temporaryHandle.writeFile(content, "utf8");
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await rename(temporaryPath, targetPath);
    temporaryPath = undefined;
  } finally {
    if (temporaryPath && parentHandle) {
      await unlink(temporaryPath).catch(() => undefined);
    }
    if (parentHandle && parentHandle !== rootHandle) {
      await parentHandle.close().catch(() => undefined);
    }
    await rootHandle?.close().catch(() => undefined);
  }
}

export async function createDeliveryWorkspace(input: {
  rootPath: string;
  operationId: string;
  baseRevision: string;
  changes: readonly { path: string; newContent: string }[];
}): Promise<DeliveryWorkspace> {
  const workspaceRoot = deliveryWorkspacePath(input.operationId);
  await mkdir(WORKSPACES_DIR, { recursive: true });
  try {
    // Project roots may be stable symlink aliases (imports and test fixtures
    // commonly use them). Clone the resolved directory, while retaining the
    // caller's root identity in the returned workspace metadata.
    const sourceRoot = await realpath(input.rootPath);
    const baseTreeHash = await hashDeliveryTree(sourceRoot);
    // A retry of the same operation may be recovering a failed validation.
    // Reuse is allowed only for the exact server-owned workspace marker;
    // another operation's workspace is never removed.
    try {
      if ((await readFile(path.join(workspaceRoot, MARKER), "utf8")) === `${input.operationId}\n`) {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    } catch {
      // The destination does not exist yet.
    }
    const resolvedInputRoot = path.resolve(sourceRoot);
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const workspaceIsInsideSource =
      resolvedWorkspaceRoot.startsWith(`${resolvedInputRoot}${path.sep}`);
    const copyDestination = workspaceIsInsideSource
      ? path.join("/tmp", `engineeringos-delivery-${input.operationId}`)
      : workspaceRoot;
    await rm(copyDestination, { recursive: true, force: true });
    await cp(sourceRoot, copyDestination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
      filter: (source) => {
        const basename = path.basename(source);
        // Runtime command sockets/pipes are never project content and are
        // not copyable by fs.cp.
        if (
          source.endsWith(".pipe")
          || source.endsWith(".sock")
          || basename.startsWith(".org.chromium.")
          || /^(?:SingletonSocket|SingletonCookie|SingletonLock)$/.test(basename)
        ) return false;
        if (shouldExcludeDeliveryEntry(source, resolvedInputRoot)) return false;
        // The managed delivery directory may live inside the project root
        // (the workspace itself is a valid project root). Never recurse into
        // it while cloning a new delivery workspace; it can contain active
        // test/runtime pipes that cannot be copied.
        const resolvedSource = path.resolve(source);
        const resolvedManagedRoot = path.resolve(WORKSPACES_DIR);
        if (
          resolvedSource === resolvedManagedRoot ||
          resolvedSource.startsWith(`${resolvedManagedRoot}${path.sep}`)
        ) {
          return false;
        }
        const normalized = source.replaceAll("\\", "/");
        return !normalized.includes("/.engineeringos-delivery/");
      },
    });
    if (copyDestination !== workspaceRoot) {
      // The managed workspace can be on a different filesystem from /tmp.
      // Copy the already-filtered temporary tree instead of relying on a
      // cross-device rename during imports whose source is the workspace root.
      await cp(copyDestination, workspaceRoot, {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
      });
      await rm(copyDestination, { recursive: true, force: true });
    }
    await writeFile(path.join(workspaceRoot, MARKER), `${input.operationId}\n`, { flag: "wx", mode: 0o600 });
    for (const change of input.changes) {
      await writeDeliveryWorkspaceFile(workspaceRoot, change.path, change.newContent);
    }
    const candidateTreeHash = await hashDeliveryTree(workspaceRoot);
    return {
      operationId: input.operationId,
      rootPath: input.rootPath,
      workspaceRoot,
      baseRevision: input.baseRevision,
      changeSetHash: hashChangeSet(input.changes),
      baseTreeHash,
      candidateTreeHash,
      lifecycle: "isolated",
    };
  } catch (error) {
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function discardDeliveryWorkspace(workspaceRoot: string, operationId: string): Promise<boolean> {
  const candidate = path.resolve(workspaceRoot);
  if (candidate !== deliveryWorkspacePath(operationId)) return false;
  try {
    if ((await readFile(path.join(candidate, MARKER), "utf8")) !== `${operationId}\n`) return false;
  } catch {
    return false;
  }
  await rm(candidate, { recursive: true, force: true });
  return true;
}

/** Verify that a persisted delivery workspace is still the exact server-owned workspace. */
export async function deliveryWorkspaceExists(workspaceRoot: string | null, operationId: string): Promise<boolean> {
  if (!workspaceRoot) return false;
  const candidate = path.resolve(workspaceRoot);
  if (candidate !== deliveryWorkspacePath(operationId)) return false;
  try {
    return (await readFile(path.join(candidate, MARKER), "utf8")) === `${operationId}\n`;
  } catch {
    return false;
  }
}

export function transitionDeliveryLifecycle(
  current: DeliveryLifecycle,
  next: DeliveryLifecycle,
): boolean {
  if (current === next) return true;
  const allowed: Record<DeliveryLifecycle, readonly DeliveryLifecycle[]> = {
    proposed: ["isolated", "cancelled", "abandoned", "blocked"],
    isolated: ["validated", "conflicted", "cancelled", "abandoned", "blocked"],
    validated: ["applied", "conflicted", "cancelled", "abandoned", "blocked"],
    applied: ["committed", "conflicted", "cancelled", "blocked"],
    conflicted: ["isolated", "cancelled", "abandoned", "blocked"],
    committed: [],
    cancelled: [],
    abandoned: [],
    blocked: [],
  };
  return allowed[current].includes(next);
}