import { asc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";
import type { ScanJobTransaction } from "./job-lease.js";

const sourceGraphEntity = alias(graphEntitiesTable, "scan_snapshot_source");
const targetGraphEntity = alias(graphEntitiesTable, "scan_snapshot_target");

/** Bound the amount of graph state materialized for one invalidation decision. */
export const GRAPH_RELATIONSHIP_SNAPSHOT_MAX_ROWS = 20_000;

export type PersistedGraphRelationshipSnapshotRow = {
  id: string;
  scanJobId: string | null;
  sourcePath: string | null;
  targetPath: string | null;
  isRuntimeObserved: boolean | null;
  provenance: unknown;
};

export type GraphRelationshipSnapshotUnavailableReason =
  | "invalid_project_id"
  | "invalid_snapshot_limit"
  | "relationship_snapshot_limit"
  | "relationship_scope_mismatch";

export type GraphRelationshipSnapshotResult =
  | {
      available: true;
      projectId: string;
      relationships: PersistedGraphRelationshipSnapshotRow[];
    }
  | {
      available: false;
      projectId: string;
      reason: GraphRelationshipSnapshotUnavailableReason;
    };

/**
 * Load the bounded relationship inventory required by a graph refresh plan.
 *
 * Both endpoints are joined independently so the invalidation planner can
 * reason about source and target path changes without materializing entity
 * payloads. The OR scope includes legacy rows whose denormalized project_id is
 * NULL but whose endpoint entities still belong to this project.
 *
 * A row is rejected when its denormalized project id disagrees with its
 * endpoint ownership, or when either endpoint cannot be resolved to this
 * project. A capped result is also rejected rather than treated as complete.
 */
export async function loadGraphRelationshipSnapshot(
  tx: ScanJobTransaction,
  projectId: string,
  options: { maxRows?: number } = {},
): Promise<GraphRelationshipSnapshotResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    return { available: false, projectId: "", reason: "invalid_project_id" };
  }

  const maxRows = options.maxRows ?? GRAPH_RELATIONSHIP_SNAPSHOT_MAX_ROWS;
  if (
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > GRAPH_RELATIONSHIP_SNAPSHOT_MAX_ROWS
  ) {
    return { available: false, projectId, reason: "invalid_snapshot_limit" };
  }

  const rows = await tx
    .select({
      id: graphRelationshipsTable.id,
      relationshipProjectId: graphRelationshipsTable.projectId,
      scanJobId: graphRelationshipsTable.scanJobId,
      isRuntimeObserved: graphRelationshipsTable.isRuntimeObserved,
      provenance: graphRelationshipsTable.provenance,
      sourceProjectId: sourceGraphEntity.projectId,
      sourcePath: sourceGraphEntity.path,
      targetProjectId: targetGraphEntity.projectId,
      targetPath: targetGraphEntity.path,
    })
    .from(graphRelationshipsTable)
    .leftJoin(
      sourceGraphEntity,
      eq(sourceGraphEntity.id, graphRelationshipsTable.sourceId),
    )
    .leftJoin(
      targetGraphEntity,
      eq(targetGraphEntity.id, graphRelationshipsTable.targetId),
    )
    .where(or(
      eq(graphRelationshipsTable.projectId, projectId),
      eq(sourceGraphEntity.projectId, projectId),
      eq(targetGraphEntity.projectId, projectId),
    ))
    .orderBy(asc(graphRelationshipsTable.id))
    .limit(maxRows + 1);

  if (rows.length > maxRows) {
    return {
      available: false,
      projectId,
      reason: "relationship_snapshot_limit",
    };
  }

  const relationships: PersistedGraphRelationshipSnapshotRow[] = [];
  for (const row of rows) {
    if (
      (row.relationshipProjectId !== null && row.relationshipProjectId !== projectId) ||
      row.sourceProjectId !== projectId ||
      row.targetProjectId !== projectId
    ) {
      return {
        available: false,
        projectId,
        reason: "relationship_scope_mismatch",
      };
    }

    relationships.push({
      id: row.id,
      scanJobId: row.scanJobId,
      sourcePath: row.sourcePath,
      targetPath: row.targetPath,
      isRuntimeObserved: row.isRuntimeObserved,
      provenance: row.provenance,
    });
  }

  return { available: true, projectId, relationships };
}
