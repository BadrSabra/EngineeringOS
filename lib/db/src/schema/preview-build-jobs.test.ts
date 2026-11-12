import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import {
  insertPreviewBuildJobSchema,
  previewBuildJobsTable,
} from "./preview-build-jobs.js";

test("Local input ownership evidence stays server-owned and nullable for S3 rows", () => {
  const columns = getTableColumns(previewBuildJobsTable);
  const insertShape = insertPreviewBuildJobSchema.shape;

  for (const key of [
    "inputArtifactOwnerNodeId",
    "inputArtifactOwnerKeyVersion",
    "inputArtifactStoreCommandFingerprint",
    "inputArtifactStoreReceiptFingerprint",
  ] as const) {
    assert.equal(columns[key].notNull, false);
    assert.equal(key in insertShape, false);
  }
});
