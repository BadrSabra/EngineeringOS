type ExtractedRelationshipForRefresh = {
  sourceName: string;
  targetName: string;
  sourcePath?: string;
  targetPath?: string;
  isRuntimeObserved?: boolean | null;
  provenance?: unknown;
};

type UnknownRecord = Record<string, unknown>;

export type ExtractedRelationshipSelectionFullReason =
  | "invalid_current_paths"
  | "invalid_affected_paths"
  | "affected_path_missing_from_current_manifest"
  | "relationship_endpoint_path_missing"
  | "relationship_provenance_missing"
  | "relationship_evidence_missing"
  | "relationship_evidence_path_invalid"
  | "invalid_runtime_marker";

export type ExtractedRelationshipSelectionResult<T> =
  | {
      mode: "incremental";
      relationships: T[];
      selectedCount: number;
      inspectedCount: number;
    }
  | {
      mode: "full";
      reason: ExtractedRelationshipSelectionFullReason;
    };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  ) {
    return false;
  }
  return !path.split(/[\\/]/).some((segment) =>
    segment.length === 0 || segment === "." || segment === "..",
  );
}

function isUniqueSafePathList(paths: readonly string[]): boolean {
  if (!Array.isArray(paths)) return false;
  const seen = new Set<string>();
  for (const path of paths) {
    if (typeof path !== "string" || !isSafeRelativePath(path) || seen.has(path)) {
      return false;
    }
    seen.add(path);
  }
  return true;
}

function full<T>(
  reason: ExtractedRelationshipSelectionFullReason,
): ExtractedRelationshipSelectionResult<T> {
  return { mode: "full", reason };
}

/**
 * Select current extracted edges that must be re-persisted after a
 * modification-only graph refresh.
 *
 * The scanner sometimes omits explicit endpoint paths on import edges while
 * using file paths as sourceName/targetName. In that case a name is treated as
 * a path only when it exactly matches the current manifest. Otherwise the
 * selection is ambiguous and the caller must use the complete extracted set.
 *
 * This function is deliberately conservative: it does not infer package
 * aliases, basename matches, symbol ownership, or paths from snippets.
 */
export function selectExtractedRelationshipsForRefresh<
  T extends ExtractedRelationshipForRefresh,
>(input: {
  currentPaths: readonly string[];
  affectedPaths: readonly string[];
  relationships: readonly T[];
}): ExtractedRelationshipSelectionResult<T> {
  const { currentPaths, affectedPaths, relationships } = input;

  if (!isUniqueSafePathList(currentPaths)) {
    return full("invalid_current_paths");
  }
  if (!isUniqueSafePathList(affectedPaths)) {
    return full("invalid_affected_paths");
  }

  const currentPathSet = new Set(currentPaths);
  if (affectedPaths.some((path) => !currentPathSet.has(path))) {
    return full("affected_path_missing_from_current_manifest");
  }

  // A no-op revision does not need any graph relationship inserts.
  if (affectedPaths.length === 0) {
    return {
      mode: "incremental",
      relationships: [],
      selectedCount: 0,
      inspectedCount: 0,
    };
  }

  if (!Array.isArray(relationships)) {
    return full("relationship_provenance_missing");
  }

  const affectedPathSet = new Set(affectedPaths);
  const selected: T[] = [];

  for (const relationship of relationships) {
    if (!relationship || typeof relationship !== "object") {
      return full("relationship_provenance_missing");
    }

    if (relationship.isRuntimeObserved === true) {
      // Runtime observations have a separate persistence lifecycle.
      continue;
    }
    if (
      relationship.isRuntimeObserved !== undefined &&
      relationship.isRuntimeObserved !== false
    ) {
      return full("invalid_runtime_marker");
    }

    const sourcePath = relationship.sourcePath ??
      (currentPathSet.has(relationship.sourceName) ? relationship.sourceName : undefined);
    const targetPath = relationship.targetPath ??
      (currentPathSet.has(relationship.targetName) ? relationship.targetName : undefined);

    if (
      typeof sourcePath !== "string" ||
      !isSafeRelativePath(sourcePath) ||
      !currentPathSet.has(sourcePath) ||
      typeof targetPath !== "string" ||
      !isSafeRelativePath(targetPath) ||
      !currentPathSet.has(targetPath)
    ) {
      return full("relationship_endpoint_path_missing");
    }

    if (!isRecord(relationship.provenance)) {
      return full("relationship_provenance_missing");
    }

    const evidence = relationship.provenance.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0) {
      return full("relationship_evidence_missing");
    }

    const evidencePaths: string[] = [];
    for (const item of evidence) {
      if (
        !isRecord(item) ||
        typeof item.file !== "string" ||
        !isSafeRelativePath(item.file) ||
        !currentPathSet.has(item.file)
      ) {
        return full("relationship_evidence_path_invalid");
      }
      evidencePaths.push(item.file);
    }

    if (
      affectedPathSet.has(sourcePath) ||
      affectedPathSet.has(targetPath) ||
      evidencePaths.some((path) => affectedPathSet.has(path))
    ) {
      selected.push(relationship);
    }
  }

  return {
    mode: "incremental",
    relationships: selected,
    selectedCount: selected.length,
    inspectedCount: relationships.length,
  };
}
