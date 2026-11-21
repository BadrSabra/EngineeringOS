import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";
import type { ScanJobTransaction } from "./job-lease.js";

/**
 * Delete non-runtime-observed relationships owned by a project.
 *
 * The relationship project_id is denormalized and nullable for historical
 * rows, so endpoint entity ownership is included in the scope predicate.
 * Runtime observations remain intact while both endpoints survive; deleting a
 * stale endpoint still removes its observations through the FK cascade.
 */
export async function deleteStaticGraphRelationships(
  tx: ScanJobTransaction,
  projectId: string,
): Promise<void> {
  const projectEntityIds = tx
    .select({ id: graphEntitiesTable.id })
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, projectId));

  await tx
    .delete(graphRelationshipsTable)
    .where(and(
      or(
        eq(graphRelationshipsTable.projectId, projectId),
        and(
          isNull(graphRelationshipsTable.projectId),
          or(
            inArray(graphRelationshipsTable.sourceId, projectEntityIds),
            inArray(graphRelationshipsTable.targetId, projectEntityIds),
          ),
        ),
      ),
      or(
        eq(graphRelationshipsTable.isRuntimeObserved, false),
        isNull(graphRelationshipsTable.isRuntimeObserved),
      ),
    ));
}

export type GraphRelationshipPersistencePlan =
  | { mode: "full" }
  | {
      mode: "incremental";
      scanJobId: string;
      scanCorrelationId: string;
      scannerVersion: string;
      relationshipIdsToReplace: readonly string[];
      untouchedStaticRelationshipIds: readonly string[];
    };

/**
 * Apply an already-validated relationship decision in the caller's scan
 * transaction. Retained static edges are re-stamped as belonging to the new
 * scan while their evidence and extraction metadata remain unchanged.
 */
export async function persistGraphRelationshipRefresh(
  tx: ScanJobTransaction,
  projectId: string,
  plan: GraphRelationshipPersistencePlan,
): Promise<void> {
  if (plan.mode === "full") {
    await deleteStaticGraphRelationships(tx, projectId);
    return;
  }

  if (!plan.scanJobId || !plan.scanCorrelationId || !plan.scannerVersion) {
    throw new Error("incremental graph persistence requires scan identity fields");
  }

  const replaced = new Set<string>();
  for (const id of plan.relationshipIdsToReplace) {
    if (!id || replaced.has(id)) {
      throw new Error("incremental graph persistence received duplicate replacement ids");
    }
    replaced.add(id);
  }

  const untouched = new Set<string>();
  for (const id of plan.untouchedStaticRelationshipIds) {
    if (!id || untouched.has(id) || replaced.has(id)) {
      throw new Error("incremental graph persistence received overlapping or duplicate retained ids");
    }
    untouched.add(id);
  }

  const projectSourceIds = tx
    .select({ id: graphEntitiesTable.id })
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, projectId));
  const projectTargetIds = tx
    .select({ id: graphEntitiesTable.id })
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, projectId));
  const belongsToProject = or(
    eq(graphRelationshipsTable.projectId, projectId),
    and(
      isNull(graphRelationshipsTable.projectId),
      or(
        inArray(graphRelationshipsTable.sourceId, projectSourceIds),
        inArray(graphRelationshipsTable.targetId, projectTargetIds),
      ),
    ),
  );

  if (replaced.size > 0) {
    await tx
      .delete(graphRelationshipsTable)
      .where(and(
        belongsToProject,
        inArray(graphRelationshipsTable.id, [...replaced]),
        eq(graphRelationshipsTable.isRuntimeObserved, false),
      ));
  }

  if (untouched.size > 0) {
    await tx
      .update(graphRelationshipsTable)
      .set({
        scanJobId: plan.scanJobId,
        provenance: sql`jsonb_set(
          jsonb_set(
            ${graphRelationshipsTable.provenance},
            '{scanSessionId}',
            to_jsonb(${plan.scanCorrelationId}::text),
            true
          ),
          '{extractorVersion}',
          to_jsonb(${plan.scannerVersion}::text),
          true
        )`,
      })
      .where(and(
        belongsToProject,
        inArray(graphRelationshipsTable.id, [...untouched]),
        eq(graphRelationshipsTable.isRuntimeObserved, false),
      ));
  }
}
