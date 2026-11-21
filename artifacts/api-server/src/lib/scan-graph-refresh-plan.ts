type RevisionChangeSnapshot = {
  mode: "incremental" | "full";
  previousRevision: string;
  currentRevision: string;
  scannerVersion: string;
  addedPaths: readonly string[];
  modifiedPaths: readonly string[];
  deletedPaths: readonly string[];
  affectedPaths: readonly string[];
};

type PersistedGraphRelationshipSnapshot = {
  id: string;
  scanJobId: string | null;
  sourcePath: string | null;
  targetPath: string | null;
  isRuntimeObserved: boolean | null;
  provenance: unknown;
};

type ScanBaselineIdentity = {
  scanJobId: string;
  scanCorrelationId: string;
  revision: string;
  scannerVersion: string;
  previousPaths: readonly string[];
};

export type GraphRefreshFullReason =
  | "revision_plan_requires_full"
  | "manifest_change_not_modification_only"
  | "global_resolution_input_changed"
  | "invalid_revision_plan"
  | "invalid_baseline_identity"
  | "revision_identity_mismatch"
  | "invalid_relationship_identity"
  | "relationship_not_owned_by_baseline"
  | "relationship_provenance_mismatch"
  | "relationship_endpoint_path_missing"
  | "relationship_evidence_missing"
  | "relationship_evidence_path_invalid";

export interface IncrementalGraphRefreshPlan {
  mode: "incremental";
  revision: string;
  affectedEntityPaths: string[];
  relationshipIdsToReplace: string[];
  preservedRuntimeRelationshipCount: number;
}

export interface FullGraphRefreshPlan {
  mode: "full";
  reason: GraphRefreshFullReason;
}

export type GraphRefreshPlan = IncrementalGraphRefreshPlan | FullGraphRefreshPlan;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareValues(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function isGlobalResolutionInput(path: string): boolean {
  return path === "package.json"
    || path.endsWith("/package.json")
    || path === "go.mod";
}

function full(reason: GraphRefreshFullReason): FullGraphRefreshPlan {
  return { mode: "full", reason };
}

/**
 * Plan the smallest safe static-relationship replacement set for a
 * modification-only source change.
 *
 * The scanner resolves imports against the complete path inventory and the
 * workspace alias map (package.json), and resolves Go imports against go.mod.
 * Additions/deletions and resolver-input changes therefore require a full
 * graph refresh. For other modifications, both endpoint paths and every
 * persisted evidence file identify inbound/outbound affected edges.
 *
 * This helper only plans invalidation; it does not mutate graph rows or skip
 * extraction. Callers must still run the current full extraction and use this
 * plan only after revalidating the exact baseline and source snapshot.
 */
export function planGraphRelationshipRefresh(input: {
  revisionPlan: RevisionChangeSnapshot;
  baseline: ScanBaselineIdentity;
  relationships: readonly PersistedGraphRelationshipSnapshot[];
}): GraphRefreshPlan {
  const { revisionPlan, baseline, relationships } = input;

  if (revisionPlan.mode !== "incremental") {
    return full("revision_plan_requires_full");
  }
  if (
    !isUniqueSafePathList(revisionPlan.addedPaths) ||
    !isUniqueSafePathList(revisionPlan.modifiedPaths) ||
    !isUniqueSafePathList(revisionPlan.deletedPaths) ||
    !isUniqueSafePathList(revisionPlan.affectedPaths)
  ) {
    return full("invalid_revision_plan");
  }

  if (revisionPlan.addedPaths.length > 0 || revisionPlan.deletedPaths.length > 0) {
    return full("manifest_change_not_modification_only");
  }

  const modifiedPaths = [...revisionPlan.modifiedPaths].sort(compareValues);
  const affectedPaths = [...revisionPlan.affectedPaths].sort(compareValues);
  if (
    modifiedPaths.length !== affectedPaths.length ||
    modifiedPaths.some((path, index) => path !== affectedPaths[index])
  ) {
    return full("invalid_revision_plan");
  }

  if (modifiedPaths.some(isGlobalResolutionInput)) {
    return full("global_resolution_input_changed");
  }

  if (
    typeof baseline.scanJobId !== "string" ||
    baseline.scanJobId.length === 0 ||
    typeof baseline.scanCorrelationId !== "string" ||
    baseline.scanCorrelationId.length === 0 ||
    typeof baseline.revision !== "string" ||
    baseline.revision.length === 0 ||
    typeof baseline.scannerVersion !== "string" ||
    baseline.scannerVersion.length === 0 ||
    !isUniqueSafePathList(baseline.previousPaths)
  ) {
    return full("invalid_baseline_identity");
  }

  if (
    revisionPlan.previousRevision !== baseline.revision ||
    revisionPlan.scannerVersion !== baseline.scannerVersion ||
    typeof revisionPlan.currentRevision !== "string" ||
    revisionPlan.currentRevision.length === 0
  ) {
    return full("revision_identity_mismatch");
  }

  const previousPaths = new Set(baseline.previousPaths);
  if (modifiedPaths.some((path) => !previousPaths.has(path))) {
    return full("invalid_revision_plan");
  }
  const modifiedPathSet = new Set(modifiedPaths);
  const relationshipIdsToReplace: string[] = [];
  let preservedRuntimeRelationshipCount = 0;
  const seenRelationshipIds = new Set<string>();

  for (const relationship of relationships) {
    if (
      !relationship ||
      typeof relationship.id !== "string" ||
      relationship.id.length === 0 ||
      seenRelationshipIds.has(relationship.id)
    ) {
      return full("invalid_relationship_identity");
    }
    seenRelationshipIds.add(relationship.id);

    // Runtime observations have independent session/revision evidence. They
    // are not scanner-owned and stay outside this static invalidation.
    if (relationship.isRuntimeObserved === true) {
      preservedRuntimeRelationshipCount += 1;
      continue;
    }
    if (relationship.isRuntimeObserved !== false) {
      return full("invalid_relationship_identity");
    }

    if (relationship.scanJobId !== baseline.scanJobId) {
      return full("relationship_not_owned_by_baseline");
    }
    if (
      !isRecord(relationship.provenance) ||
      relationship.provenance.scanSessionId !== baseline.scanCorrelationId ||
      relationship.provenance.extractorVersion !== baseline.scannerVersion
    ) {
      return full("relationship_provenance_mismatch");
    }

    if (
      typeof relationship.sourcePath !== "string" ||
      !isSafeRelativePath(relationship.sourcePath) ||
      !previousPaths.has(relationship.sourcePath) ||
      typeof relationship.targetPath !== "string" ||
      !isSafeRelativePath(relationship.targetPath) ||
      !previousPaths.has(relationship.targetPath)
    ) {
      return full("relationship_endpoint_path_missing");
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
        !previousPaths.has(item.file)
      ) {
        return full("relationship_evidence_path_invalid");
      }
      evidencePaths.push(item.file);
    }

    if (
      modifiedPathSet.has(relationship.sourcePath) ||
      modifiedPathSet.has(relationship.targetPath) ||
      evidencePaths.some((path) => modifiedPathSet.has(path))
    ) {
      relationshipIdsToReplace.push(relationship.id);
    }
  }

  relationshipIdsToReplace.sort(compareValues);
  return {
    mode: "incremental",
    revision: revisionPlan.currentRevision,
    affectedEntityPaths: modifiedPaths,
    relationshipIdsToReplace,
    preservedRuntimeRelationshipCount,
  };
}
