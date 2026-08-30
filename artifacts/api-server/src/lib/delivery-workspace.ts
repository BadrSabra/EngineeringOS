import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile, readdir, lstat, readlink, rename } from "node:fs/promises";
import path from "node:path";

export type DeliveryLifecycle =
  | "proposed" | "isolated" | "validated" | "applied" | "conflicted"
  | "committed" | "cancelled" | "abandoned" | "blocked";

/** Replace one live-root file without exposing a truncated file to readers. */
export async function atomicallyPromoteFile(
  target: string,
  content: string,
  operationId: string,
): Promise<void> {
  const temp = `${target}.engineeringos-promotion-${operationId}-${process.pid}-${randomUUID()}`;
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
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
  | "DELIVERY_TREE_UNSAFE_PATH";

export class DeliveryTreeDigestError extends Error {
  readonly code: DeliveryTreeDigestErrorCode;

  constructor(code: DeliveryTreeDigestErrorCode, message: string) {
    super(message);
    this.name = "DeliveryTreeDigestError";
    this.code = code;
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
  let changed = false;
  for (const change of params.changes) {
    const target = path.resolve(params.rootPath, change.path);
    if (target !== path.resolve(params.rootPath) && !target.startsWith(`${path.resolve(params.rootPath)}${path.sep}`)) {
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
    await atomicallyPromoteFile(target, expected, params.operationId);
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
export async function hashDeliveryTree(rootPath: string): Promise<string> {
  const resolvedRoot = path.resolve(rootPath);
  const entries: Array<{ path: string; kind: "directory" | "file" | "symlink" | "other"; bytes?: string }> = [];
  const seenPaths = new Set<string>();
  async function visit(directory: string): Promise<void> {
    let children;
    try {
      children = (await readdir(directory, { withFileTypes: true }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      throw new DeliveryTreeDigestError(
        directory === resolvedRoot ? "DELIVERY_TREE_ROOT_UNAVAILABLE" : "DELIVERY_TREE_ENTRY_UNREADABLE",
        "Delivery tree could not be read.",
      );
    }
    for (const entry of children) {
      const absolute = path.join(directory, entry.name);
      if (shouldExcludeDeliveryEntry(absolute, resolvedRoot) || (directory === resolvedRoot && entry.name === MARKER)) continue;
      const relative = normalizeDeliveryRelativePath(path.relative(resolvedRoot, absolute));
      if (seenPaths.has(relative)) {
        throw new DeliveryTreeDigestError("DELIVERY_TREE_UNSAFE_PATH", "Delivery tree contains duplicate normalized paths.");
      }
      seenPaths.add(relative);
      let stat;
      try {
        stat = await lstat(absolute);
      } catch {
        throw new DeliveryTreeDigestError("DELIVERY_TREE_ENTRY_UNREADABLE", "Delivery tree entry could not be inspected.");
      }
      if (stat.isDirectory()) {
        entries.push({ path: relative, kind: "directory" });
        await visit(absolute);
      } else if (stat.isFile()) {
        try {
          entries.push({ path: relative, kind: "file", bytes: (await readFile(absolute)).toString("base64") });
        } catch {
          throw new DeliveryTreeDigestError("DELIVERY_TREE_ENTRY_UNREADABLE", "Delivery tree file could not be read.");
        }
      } else if (stat.isSymbolicLink()) {
        try {
          entries.push({ path: relative, kind: "symlink", bytes: Buffer.from(await readlink(absolute), "utf8").toString("base64") });
        } catch {
          throw new DeliveryTreeDigestError("DELIVERY_TREE_ENTRY_UNREADABLE", "Delivery tree symlink could not be read.");
        }
      } else {
        entries.push({ path: relative, kind: "other" });
      }
    }
  }
  try {
    const stat = await lstat(resolvedRoot);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new DeliveryTreeDigestError("DELIVERY_TREE_ROOT_UNAVAILABLE", "Delivery tree root is unavailable.");
  }
  await visit(resolvedRoot);
  const canonical = JSON.stringify({ version: DELIVERY_TREE_DIGEST_VERSION, entries });
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex");
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
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error("Invalid delivery operation identity");
  return path.join(WORKSPACES_DIR, operationId);
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
    const baseTreeHash = await hashDeliveryTree(input.rootPath);
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
    const resolvedInputRoot = path.resolve(input.rootPath);
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const workspaceIsInsideSource =
      resolvedWorkspaceRoot.startsWith(`${resolvedInputRoot}${path.sep}`);
    const copyDestination = workspaceIsInsideSource
      ? path.join("/tmp", `engineeringos-delivery-${input.operationId}`)
      : workspaceRoot;
    await rm(copyDestination, { recursive: true, force: true });
    await cp(input.rootPath, copyDestination, {
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
      await rename(copyDestination, workspaceRoot);
    }
    await writeFile(path.join(workspaceRoot, MARKER), `${input.operationId}\n`, { flag: "wx", mode: 0o600 });
    for (const change of input.changes) {
      const relative = change.path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
      const target = path.resolve(workspaceRoot, relative);
      if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
        throw new Error("Delivery change escapes isolated workspace");
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, change.newContent, "utf8");
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