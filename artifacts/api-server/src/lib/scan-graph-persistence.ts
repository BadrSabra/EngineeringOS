import { and, eq, isNull, or } from "drizzle-orm";
import { graphRelationshipsTable } from "@workspace/db";
import type { ScanJobTransaction } from "./job-lease.js";

/**
 * Delete non-runtime-observed graph relationships before a static refresh.
 *
 * Runtime observations are written independently of the scanner and carry
 * evidence from an active workspace session. They must not be erased merely
 * because a source refresh runs. Edges with a legacy NULL flag are treated as
 * non-runtime and continue to be replaced by the scan.
 *
 * Runtime edges whose source or target entity is actually removed are still
 * deleted by the graph_entities foreign-key cascade.
 */
export async function deleteStaticGraphRelationships(
  tx: ScanJobTransaction,
  projectId: string,
): Promise<void> {
  await tx
    .delete(graphRelationshipsTable)
    .where(and(
      eq(graphRelationshipsTable.projectId, projectId),
      or(
        eq(graphRelationshipsTable.isRuntimeObserved, false),
        isNull(graphRelationshipsTable.isRuntimeObserved),
      ),
    ));
}
