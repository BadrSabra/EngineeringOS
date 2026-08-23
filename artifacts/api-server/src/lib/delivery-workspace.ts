import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";

export type DeliveryLifecycle =
  | "proposed" | "isolated" | "validated" | "applied" | "conflicted"
  | "committed" | "cancelled" | "abandoned" | "blocked";

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
    await cp(input.rootPath, workspaceRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (source) => {
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