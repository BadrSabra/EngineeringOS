import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Durable roots created from Git clones and archive uploads.
 *
 * This directory is intentionally inside the workspace boundary so the
 * existing project-root safety policy can establish it before it is persisted
 * to the database. Direct project roots are never removed by this module
 * unless they carry the managed-root marker written below.
 */
export const MANAGED_PROJECT_ROOTS_DIR = join(
  process.env.WORKSPACE_PATH ?? "/home/runner/workspace",
  ".engineeringos-projects",
);

const MANAGED_ROOT_MARKER = ".engineeringos-managed-root";
const MANAGED_ROOT_MARKER_CONTENT = "engineeringos-managed-project-root\n";

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error("Invalid discovery session identifier for materialized project root");
  }
}

/** Return the app-owned destination for one discovery session. */
export function managedProjectRootForSession(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(MANAGED_PROJECT_ROOTS_DIR, sessionId);
}

/**
 * Copy a resolver-owned temporary directory into an app-owned durable root.
 * The destination must not already exist; a partially copied destination is
 * removed if the operation fails.
 */
export async function materializeProjectRoot(
  sourcePath: string,
  sessionId: string,
): Promise<string> {
  const destination = managedProjectRootForSession(sessionId);
  const sourceCanonical = await realpath(sourcePath);
  const sourceStats = await lstat(sourceCanonical);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Cannot materialize non-directory source: ${sourcePath}`);
  }

  await mkdir(MANAGED_PROJECT_ROOTS_DIR, { recursive: true });
  try {
    await cp(sourceCanonical, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    await writeFile(
      join(destination, MANAGED_ROOT_MARKER),
      MANAGED_ROOT_MARKER_CONTENT,
      { flag: "wx", mode: 0o600 },
    );
    return destination;
  } catch (err) {
    await rm(destination, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

function isDirectChildOfManagedRoots(rootPath: string): boolean {
  const base = resolve(MANAGED_PROJECT_ROOTS_DIR);
  const candidate = resolve(rootPath);
  const child = relative(base, candidate);
  return (
    child.length > 0 &&
    !child.startsWith(`..${sep}`) &&
    child !== ".." &&
    !isAbsolute(child) &&
    !child.includes(sep)
  );
}

/**
 * Remove a durable root only when it is an app-owned, marked direct child.
 * Returns false for a caller-supplied root or any path outside the managed
 * directory, preventing project deletion from deleting user files.
 */
export async function removeManagedProjectRoot(rootPath: string): Promise<boolean> {
  if (!isDirectChildOfManagedRoots(rootPath)) return false;

  const candidate = resolve(rootPath);
  try {
    const stats = await lstat(candidate);
    if (!stats.isDirectory()) return false;
    const marker = await readFile(join(candidate, MANAGED_ROOT_MARKER), "utf8");
    if (marker !== MANAGED_ROOT_MARKER_CONTENT) return false;
  } catch {
    return false;
  }

  await rm(candidate, { recursive: true, force: true });
  return true;
}