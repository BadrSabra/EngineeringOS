import {
  planRevisionManifestDiff,
  type ExtractedRelationship,
  type RevisionManifest,
} from "@workspace/scanner";
import { loadLatestCompleteScanBaseline } from "./scan-revision-baseline.js";
import { loadGraphRelationshipSnapshot } from "./scan-graph-relationship-snapshot.js";
import { planGraphRelationshipRefresh } from "./scan-graph-refresh-plan.js";
import { selectExtractedRelationshipsForRefresh } from "./scan-graph-relationship-selection.js";
import type { ScanJobTransaction } from "./job-lease.js";

export type IncrementalGraphRefreshExecutionPlan = {
  mode: "incremental";
  revision: string;
  affectedEntityPaths: string[];
  relationshipIdsToReplace: string[];
  untouchedStaticRelationshipIds: string[];
  relationshipsToPersist: ExtractedRelationship[];
  preservedRuntimeRelationshipCount: number;
};

export type FullGraphRefreshExecutionPlan = {
  mode: "full";
  reason: string;
};

export type GraphRefreshExecutionPlan =
  | IncrementalGraphRefreshExecutionPlan
  | FullGraphRefreshExecutionPlan;

/**
 * Compose every prerequisite read and pure planner under one caller-owned
 * transaction. No graph writes happen here.
 *
 * File walking and graph extraction still run with the full repository
 * inventory. This planner only decides whether relationship persistence can
 * safely be narrowed for modification-only revisions.
 */
export async function planTransactionalGraphRefresh(input: {
  tx: ScanJobTransaction;
  projectId: string;
  scanJobId: string | null | undefined;
  currentManifest: RevisionManifest;
  scannerVersion: string;
  graphRelationships: readonly ExtractedRelationship[];
  graphIncomplete: boolean;
}): Promise<GraphRefreshExecutionPlan> {
  const full = (reason: string): FullGraphRefreshExecutionPlan => ({
    mode: "full",
    reason,
  });

  if (!input.scanJobId) return full("durable_scan_job_required");
  if (input.graphIncomplete) return full("current_graph_incomplete");

  const baselineRead = await loadLatestCompleteScanBaseline(
    input.tx,
    input.projectId,
  );
  if (!baselineRead.available) {
    return full(`baseline_unavailable:${baselineRead.reason}`);
  }

  const revisionPlan = planRevisionManifestDiff(
    baselineRead.baseline.manifest,
    input.currentManifest,
    {
      previousScannerVersion: baselineRead.baseline.scannerVersion,
      currentScannerVersion: input.scannerVersion,
    },
  );
  if (revisionPlan.mode !== "incremental") {
    return full(`revision_diff_requires_full:${revisionPlan.reason}`);
  }

  const snapshotRead = await loadGraphRelationshipSnapshot(
    input.tx,
    input.projectId,
  );
  if (!snapshotRead.available) {
    return full(`relationship_snapshot_unavailable:${snapshotRead.reason}`);
  }

  const invalidationPlan = planGraphRelationshipRefresh({
    revisionPlan,
    baseline: {
      scanJobId: baselineRead.baseline.scanJobId,
      scanCorrelationId: baselineRead.baseline.scanCorrelationId,
      revision: baselineRead.baseline.manifest.revision,
      scannerVersion: baselineRead.baseline.scannerVersion,
      previousPaths: baselineRead.baseline.manifest.files.map((file) => file.path),
    },
    relationships: snapshotRead.relationships,
  });
  if (invalidationPlan.mode !== "incremental") {
    return full(`relationship_invalidation_requires_full:${invalidationPlan.reason}`);
  }

  const selection = selectExtractedRelationshipsForRefresh({
    currentPaths: input.currentManifest.files.map((file) => file.path),
    affectedPaths: invalidationPlan.affectedEntityPaths,
    relationships: input.graphRelationships,
  });
  if (selection.mode !== "incremental") {
    return full(`relationship_selection_requires_full:${selection.reason}`);
  }

  const replacedIds = new Set(invalidationPlan.relationshipIdsToReplace);
  const untouchedStaticRelationshipIds = snapshotRead.relationships
    .filter((relationship) =>
      relationship.isRuntimeObserved === false &&
      !replacedIds.has(relationship.id),
    )
    .map((relationship) => relationship.id)
    .sort();

  return {
    mode: "incremental",
    revision: invalidationPlan.revision,
    affectedEntityPaths: invalidationPlan.affectedEntityPaths,
    relationshipIdsToReplace: invalidationPlan.relationshipIdsToReplace,
    untouchedStaticRelationshipIds,
    relationshipsToPersist: selection.relationships,
    preservedRuntimeRelationshipCount: invalidationPlan.preservedRuntimeRelationshipCount,
  };
}
