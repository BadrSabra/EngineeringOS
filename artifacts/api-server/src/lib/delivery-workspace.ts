import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile, readdir, lstat, rename } from "node:fs/promises";
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
 * Hash the complete candidate tree, excluding the server-owned marker.
 * Sorting paths and including file type/content makes this stable across
 * platforms and proves validation observed the exact bytes in the workspace.
 */
export async function hashDeliveryWorkspace(workspaceRoot: string): Promise<string> {
  const entries: Array<{ path: string; kind: string; content: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (directory === workspaceRoot && entry.name === MARKER) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(workspaceRoot, absolute).replaceAll("\\", "/");
      const stat = await lstat(absolute);
      if (stat.isDirectory()) {
        await visit(absolute);
      } else if (stat.isFile()) {
        entries.push({ path: relative, kind: "file", content: (await readFile(absolute)).toString("base64") });
      } else if (stat.isSymbolicLink()) {
        entries.push({ path: relative, kind: "symlink", content: await readFile(absolute, "utf8").catch(() => "") });
      }
    }
  }
  await visit(workspaceRoot);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

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
        if (source.includes(".engineeringos-delivery")) return false;
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
        return ![
          ".git",
          "node_modules",
          ".engineeringos-delivery",
          ".engineeringos-projects",
          ".agents",
          ".local",
          ".X11-unix",
        ].includes(path.basename(source))
          && !normalized.includes("/.engineeringos-delivery/");
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
    return {
      operationId: input.operationId,
      rootPath: input.rootPath,
      workspaceRoot,
      baseRevision: input.baseRevision,
      changeSetHash: hashChangeSet(input.changes),
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