import { stat, access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { validateRootPath, verifyProjectRoot, EOS_GIT_TEMP_PREFIX } from "./path-validation.js";

/**
 * Structured outcome of establishing a canonical project root.
 *
 * Success carries the canonical (realpath-resolved, normalized) path that
 * MUST be the value persisted to projects.root_path — never the raw
 * client/session string.
 *
 * Failure carries an HTTP status, a machine-readable reason, and a
 * user-facing error message.
 */
export type EstablishRootResult =
  | { ok: true; canonicalPath: string }
  | { ok: false; status: number; reason: EstablishRootFailureReason; error: string };

export type EstablishRootFailureReason =
  | "root_not_found"
  | "root_unavailable"
  | "root_not_directory"
  | "root_not_readable"
  | "root_unsafe"
  | "root_no_project_markers";

export interface EstablishRootOptions {
  /**
   * When true, the directory must contain at least one recognisable
   * project-root marker (package.json, pyproject.toml, Cargo.toml, go.mod,
   * .git). Used for direct project creation, where an arbitrary directory
   * would otherwise become the root of scans and AI operations.
   */
  requireMarkers?: boolean;
  /**
   * When true, canonical paths under the managed git-clone temp prefix
   * (/tmp/eos-git-*) are allowed. Only the discovery-import flow may set
   * this — for direct project creation a temp-prefix path is not provenance,
   * so it is rejected as unsafe.
   */
  allowManagedTempRoot?: boolean;
}

/**
 * Establish a trustworthy canonical project root.
 *
 * This is the single boundary through which a filesystem path becomes a
 * persisted project root. It:
 *  1. Normalizes the input (leading slash, no trailing slashes).
 *  2. Requires the path to EXIST and be a readable DIRECTORY.
 *  3. Resolves symlinks via realpath() to the canonical path.
 *  4. Applies the path-safety policy (depth, blocked system paths,
 *     workspace boundary) to the RESOLVED path.
 *  5. Optionally requires project-root markers.
 *
 * Dead temporary git-clone roots (/tmp/eos-git-*) are rejected with an
 * explicit "root_unavailable" reason so callers can tell the user to re-run
 * discovery — they are never silently rebound to another directory.
 */
export async function establishProjectRoot(
  rootPath: string,
  options: EstablishRootOptions = {},
): Promise<EstablishRootResult> {
  if (typeof rootPath !== "string" || rootPath.trim() === "") {
    return {
      ok: false,
      status: 422,
      reason: "root_not_found",
      error: "rootPath must be a non-empty absolute path to an existing project directory.",
    };
  }

  const withSlash = rootPath.startsWith("/") ? rootPath : `/${rootPath}`;
  const normalized = withSlash.replace(/\/+$/, "") || "/";

  // 1. Existence — the directory must exist NOW. A missing managed git-clone
  // temp dir means the clone was cleaned up; require a fresh discovery run
  // instead of rebinding to some other directory.
  let stats;
  try {
    stats = await stat(normalized);
  } catch {
    if (normalized.startsWith(EOS_GIT_TEMP_PREFIX)) {
      return {
        ok: false,
        status: 409,
        reason: "root_unavailable",
        error:
          "The temporary clone directory for this discovery session no longer exists. " +
          "Re-run discovery on the repository and import again.",
      };
    }
    return {
      ok: false,
      status: 422,
      reason: "root_not_found",
      error: `Path "${normalized}" does not exist or is not accessible.`,
    };
  }

  if (!stats.isDirectory()) {
    return {
      ok: false,
      status: 422,
      reason: "root_not_directory",
      error: `Path "${normalized}" is not a directory.`,
    };
  }

  // 2. Readability — must be able to read + traverse the directory.
  try {
    await access(normalized, constants.R_OK | constants.X_OK);
  } catch {
    return {
      ok: false,
      status: 422,
      reason: "root_not_readable",
      error: `Directory "${normalized}" is not readable.`,
    };
  }

  // 3. Canonicalize — resolve all symlinks. From here on, only the resolved
  // path matters; a symlink at a valid location pointing outside the allowed
  // zone must be judged by its target.
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(normalized);
  } catch {
    return {
      ok: false,
      status: 422,
      reason: "root_not_found",
      error: `Path "${normalized}" could not be resolved to a canonical location.`,
    };
  }

  // 4. Managed temp-clone prefix is only provenance in the discovery-import
  // flow. Anyone can create /tmp/eos-git-<anything>, so direct creation must
  // never accept it.
  if (!options.allowManagedTempRoot && canonicalPath.startsWith(EOS_GIT_TEMP_PREFIX)) {
    return {
      ok: false,
      status: 422,
      reason: "root_unsafe",
      error:
        "Temporary discovery clone directories cannot be registered directly. " +
        "Import the project through a discovery session instead.",
    };
  }

  // 5. Safety policy on the canonical path (depth, blocked system paths,
  // workspace boundary, temp-clone allowance).
  const unsafe = await validateRootPath(canonicalPath);
  if (unsafe) {
    return { ok: false, status: 422, reason: "root_unsafe", error: unsafe };
  }

  // 6. Project markers (optional).
  if (options.requireMarkers) {
    const markerError = await verifyProjectRoot(canonicalPath);
    if (markerError) {
      return { ok: false, status: 422, reason: "root_no_project_markers", error: markerError };
    }
  }

  return { ok: true, canonicalPath };
}
