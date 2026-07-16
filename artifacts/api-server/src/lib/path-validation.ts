import { stat } from "node:fs/promises";

/**
 * System-level paths that must never be scanned — they contain the entire
 * filesystem or OS internals, and walking them causes OOM.
 */
const BLOCKED_PATH_PREFIXES = new Set([
  "/",
  "/home",
  "/usr",
  "/etc",
  "/nix",
  "/tmp",
  "/var",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/proc",
  "/sys",
  "/dev",
  "/boot",
  "/run",
  "/srv",
  "/opt",
  "/root",
]);

/**
 * Temp-dir prefix used exclusively by gitRepositoryAdapter.
 * These paths are always safe to scan — they are shallow git clones in a
 * uniquely-named UUID directory we created, never OS internals.
 * Bypass depth and environment constraints for them.
 */
export const EOS_GIT_TEMP_PREFIX = "/tmp/eos-git-";

/**
 * Returns a rejection reason string if `rootPath` is unsafe, or null if OK.
 * Rules:
 *  0. Paths starting with EOS_GIT_TEMP_PREFIX are unconditionally allowed —
 *     they are controlled git-clone temp dirs, not OS paths.
 *  1. Must have at least 3 path segments (e.g. /home/runner/workspace).
 *  2. Must not be an exact match of a known system prefix.
 *  3. In Replit environments (REPLIT_DEV_DOMAIN set), must be under
 *     /home/runner/workspace so we never scan the host OS.
 */
export function validateRootPath(rootPath: string): string | null {
  // Auto-prepend "/" so "home/runner/..." is treated the same as "/home/runner/..."
  const withSlash = rootPath.startsWith("/") ? rootPath : `/${rootPath}`;
  const normalized = withSlash.replace(/\/+$/, "") || "/";

  // Rule 0 — managed git-clone temp dirs are always safe; skip all other checks.
  // /tmp/eos-git-<uuid> has only 2 path segments, so it would fail Rule 1 without
  // this early return. These paths are created exclusively by gitRepositoryAdapter
  // and are safe to scan.
  if (normalized.startsWith(EOS_GIT_TEMP_PREFIX)) {
    return null;
  }

  // Rule 1 — minimum depth
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 3) {
    return (
      `Path "${normalized}" is too shallow (${segments.length} segment(s)). ` +
      "Provide the full path to a specific project directory, e.g. /home/runner/workspace/my-project."
    );
  }

  // Rule 2 — system root block list (exact match only)
  if (BLOCKED_PATH_PREFIXES.has(normalized)) {
    return (
      `Path "${normalized}" is a system directory and cannot be scanned. ` +
      "Provide the full path to a specific project directory."
    );
  }

  // Rule 3 — Replit environment: must be under /home/runner/workspace
  if (process.env.REPLIT_DEV_DOMAIN) {
    const WORKSPACE = "/home/runner/workspace";
    if (!normalized.startsWith(WORKSPACE)) {
      return (
        `In this environment, the project path must be under ${WORKSPACE}. ` +
        `Received: "${normalized}".`
      );
    }
  }

  return null;
}

/**
 * Marker files/dirs whose presence at the root of a directory indicates a
 * recognisable software project.
 */
const PROJECT_ROOT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  ".git",
];

/**
 * Returns null when `rootPath` contains at least one known project-root marker
 * (package.json, pyproject.toml, Cargo.toml, go.mod, .git).
 * Returns an error message string when none are found — the caller should
 * reject the request with 422 before starting a scan.
 *
 * Used for GIT_REPOSITORY clones to fail fast with a useful message when the
 * remote repo has no recognisable project at its root.
 */
export async function verifyProjectRoot(rootPath: string): Promise<string | null> {
  for (const marker of PROJECT_ROOT_MARKERS) {
    try {
      await stat(`${rootPath}/${marker}`);
      return null; // at least one marker found — valid project root
    } catch {
      // marker absent, try next
    }
  }
  return (
    `No project root detected in the cloned repository. ` +
    `Expected at least one of: ${PROJECT_ROOT_MARKERS.join(", ")}. ` +
    `Make sure the repository URL points to a directory that contains a recognisable project.`
  );
}
