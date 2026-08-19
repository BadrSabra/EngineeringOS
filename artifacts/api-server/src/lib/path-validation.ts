import { stat, realpath } from "node:fs/promises";

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
 * Temp-dir prefix used by the legacy Git import path.
 *
 * The prefix is not a trust boundary: callers can create a directory with
 * the same name. Generic validation rejects it. The only valid exception is
 * an explicit allowManagedTempRoot option supplied by the Git discovery
 * provenance path after canonicalization.
 */
export const EOS_GIT_TEMP_PREFIX = "/tmp/eos-git-";

export interface RootPathValidationOptions {
  /**
   * Allows a canonical, existing legacy Git clone root. This must only be
   * passed by a caller that has independently established Git provenance.
   */
  allowManagedTempRoot?: boolean;
}

/**
 * Returns a rejection reason string if `rootPath` is unsafe, or null if OK.
 * Rules:
 *  1. Must have at least 3 path segments (e.g. /home/runner/workspace).
 *  2. Must not be an exact match of a known system prefix.
 *  3. In Replit environments (REPLIT_DEV_DOMAIN set), must be under
 *     /home/runner/workspace so we never scan the host OS.
 *  4. Symlink escape check: resolve all symlinks with realpath() and re-run
 *     Rules 1-3 on the resolved path.
 *     This prevents a symlink at /home/runner/workspace/evil-link → /etc from
 *     bypassing the path-boundary checks. If realpath() fails (path does not
 *     exist yet), the string-only rules still apply and the downstream stat()
 *     in runDiscovery will surface a clear ENOENT error.
 */
export async function validateRootPath(
  rootPath: string,
  options: RootPathValidationOptions = {},
): Promise<string | null> {
  // Auto-prepend "/" so "home/runner/..." is treated the same as "/home/runner/..."
  const withSlash = rootPath.startsWith("/") ? rootPath : `/${rootPath}`;
  const normalized = withSlash.replace(/\/+$/, "") || "/";

  // Rule 4 — resolve symlinks before running string-based boundary checks.
  // This must happen before Rules 1-3 so that a symlink pointing outside the
  // allowed zone is caught even if the *lexical* path looks valid.
  let resolved = normalized;
  try {
    resolved = await realpath(normalized);
  } catch {
    // Path does not exist (or is not accessible) — leave `resolved` as the
    // lexical path. The downstream stat() in runDiscovery will surface ENOENT.
  }

  // A legacy Git clone is allowed only after the caller has explicitly
  // established its provenance. Do this after realpath so a symlink cannot
  // smuggle an unrelated directory through a lexical prefix.
  if (resolved.startsWith(EOS_GIT_TEMP_PREFIX)) {
    if (options.allowManagedTempRoot) return null;
    return (
      `Temporary discovery clone paths cannot be scanned without verified Git ` +
      `provenance: "${normalized}".`
    );
  }

  // Run Rules 1-3 on the RESOLVED path, not the raw input.

  // Rule 1 — minimum depth
  const segments = resolved.split("/").filter(Boolean);
  if (segments.length < 3) {
    return (
      `Path "${normalized}" resolves to "${resolved}" which is too shallow ` +
      `(${segments.length} segment(s)). ` +
      "Provide the full path to a specific project directory, e.g. /home/runner/workspace/my-project."
    );
  }

  // Rule 2 — system root block list (exact match only)
  if (BLOCKED_PATH_PREFIXES.has(resolved)) {
    return (
      `Path "${normalized}" resolves to the system directory "${resolved}" and cannot be scanned. ` +
      "Provide the full path to a specific project directory."
    );
  }

  // Rule 3 — Replit environment: must be under /home/runner/workspace
  if (process.env.REPLIT_DEV_DOMAIN) {
    const WORKSPACE = "/home/runner/workspace";
    // Separator-aware containment: "/home/runner/workspace-evil" must NOT
    // pass just because it shares a string prefix with the workspace.
    if (resolved !== WORKSPACE && !resolved.startsWith(`${WORKSPACE}/`)) {
      return (
        `In this environment, the project path must be under ${WORKSPACE}. ` +
        `"${normalized}" resolves to "${resolved}".`
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
