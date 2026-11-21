import type { RevisionManifest, RevisionManifestFile } from "./file-walker.js";

export type RevisionManifestFullRefreshReason =
  | "no_previous_manifest"
  | "previous_manifest_partial"
  | "current_manifest_partial"
  | "source_root_changed"
  | "scanner_version_changed"
  | "invalid_manifest"
  | "revision_inconsistent";

export interface IncrementalRevisionManifestPlan {
  mode: "incremental";
  sourceRoot: string;
  previousRevision: string;
  currentRevision: string;
  scannerVersion: string;
  addedPaths: string[];
  modifiedPaths: string[];
  deletedPaths: string[];
  unchangedPaths: string[];
  /** Added, modified, and deleted paths, sorted and deduplicated. */
  affectedPaths: string[];
}

export interface FullRevisionManifestPlan {
  mode: "full";
  reason: RevisionManifestFullRefreshReason;
}

export type RevisionManifestDiffPlan =
  | IncrementalRevisionManifestPlan
  | FullRevisionManifestPlan;

export interface RevisionManifestDiffOptions {
  previousScannerVersion?: string | null;
  currentScannerVersion: string;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) {
    return false;
  }

  return !path.split(/[\\/]/).some((segment) =>
    segment.length === 0 || segment === "." || segment === "..",
  );
}

function validManifest(manifest: RevisionManifest): boolean {
  if (
    !manifest ||
    typeof manifest.revision !== "string" ||
    manifest.revision.length === 0 ||
    typeof manifest.sourceRoot !== "string" ||
    manifest.sourceRoot.length === 0 ||
    !Array.isArray(manifest.files)
  ) {
    return false;
  }

  const seenPaths = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !isSafeRelativePath(file.path) ||
      seenPaths.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.contentHash !== "string" ||
      file.contentHash.length === 0 ||
      typeof file.oversized !== "boolean"
    ) {
      return false;
    }
    seenPaths.add(file.path);
  }
  return true;
}

function sameFile(left: RevisionManifestFile, right: RevisionManifestFile): boolean {
  return left.size === right.size
    && left.contentHash === right.contentHash
    && left.oversized === right.oversized;
}

/**
 * Derive a conservative changed-file plan from two server-owned scanner
 * manifests. This helper does not run extraction or mutate persisted graph
 * state; callers may use an incremental plan only when every compatibility
 * gate passes. Any uncertain input deliberately requests a full refresh.
 */
export function planRevisionManifestDiff(
  previous: RevisionManifest | null | undefined,
  current: RevisionManifest,
  options: RevisionManifestDiffOptions,
): RevisionManifestDiffPlan {
  if (!previous) return { mode: "full", reason: "no_previous_manifest" };
  if (!validManifest(previous)) return { mode: "full", reason: "invalid_manifest" };
  if (!validManifest(current)) return { mode: "full", reason: "invalid_manifest" };
  if (previous.completeness !== "COMPLETE") {
    return { mode: "full", reason: "previous_manifest_partial" };
  }
  if (current.completeness !== "COMPLETE") {
    return { mode: "full", reason: "current_manifest_partial" };
  }
  if (previous.sourceRoot !== current.sourceRoot) {
    return { mode: "full", reason: "source_root_changed" };
  }
  if (
    !options.previousScannerVersion ||
    !options.currentScannerVersion ||
    options.previousScannerVersion !== options.currentScannerVersion
  ) {
    return { mode: "full", reason: "scanner_version_changed" };
  }

  const previousByPath = new Map(previous.files.map((file) => [file.path, file]));
  const currentByPath = new Map(current.files.map((file) => [file.path, file]));
  const addedPaths: string[] = [];
  const modifiedPaths: string[] = [];
  const deletedPaths: string[] = [];
  const unchangedPaths: string[] = [];

  for (const file of current.files) {
    const prior = previousByPath.get(file.path);
    if (!prior) {
      addedPaths.push(file.path);
    } else if (sameFile(prior, file)) {
      unchangedPaths.push(file.path);
    } else {
      modifiedPaths.push(file.path);
    }
  }

  for (const file of previous.files) {
    if (!currentByPath.has(file.path)) deletedPaths.push(file.path);
  }

  addedPaths.sort(comparePaths);
  modifiedPaths.sort(comparePaths);
  deletedPaths.sort(comparePaths);
  unchangedPaths.sort(comparePaths);
  const affectedPaths = [...addedPaths, ...modifiedPaths, ...deletedPaths].sort(comparePaths);

  // The revision digest is derived from the same sorted file inventory. If its
  // equality disagrees with the per-file comparison, the manifest pair cannot
  // safely establish an incremental boundary.
  const hasFileChanges = affectedPaths.length > 0;
  if ((previous.revision === current.revision) === hasFileChanges) {
    return { mode: "full", reason: "revision_inconsistent" };
  }

  return {
    mode: "incremental",
    sourceRoot: current.sourceRoot,
    previousRevision: previous.revision,
    currentRevision: current.revision,
    scannerVersion: options.currentScannerVersion,
    addedPaths,
    modifiedPaths,
    deletedPaths,
    unchangedPaths,
    affectedPaths,
  };
}
