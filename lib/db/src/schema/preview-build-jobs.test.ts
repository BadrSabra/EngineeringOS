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

test("dispatch generation is durable, positive, and server-owned", () => {
  const columns = getTableColumns(previewBuildJobsTable);

  assert.equal(columns.dispatchGeneration.notNull, true);
  assert.equal(columns.dispatchGeneration.default, 1);
  assert.equal("dispatchGeneration" in insertPreviewBuildJobSchema.shape, false);
});

test("reconciliation leases are nullable and server-owned", () => {
  const columns = getTableColumns(previewBuildJobsTable);

  assert.equal(columns.reconciliationLeaseOwner.notNull, false);
  assert.equal(columns.reconciliationLeaseExpiresAt.notNull, false);
  assert.equal(
    "reconciliationLeaseOwner" in insertPreviewBuildJobSchema.shape,
    false,
  );
  assert.equal(
    "reconciliationLeaseExpiresAt" in insertPreviewBuildJobSchema.shape,
    false,
  );
});
