import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  insertPreviewSessionSchema,
  previewSessionsTable,
} from "./preview-sessions.js";

test("Preview sessions keep AWS rows compatible and allow neutral local bindings", () => {
  const columns = getTableColumns(previewSessionsTable);
  const insertShape = insertPreviewSessionSchema.shape;

  assert.equal(columns.executionProvider.notNull, true);
  assert.equal(columns.executionProvider.default, "aws_ecs");
  assert.equal(columns.taskDefinitionArn.notNull, false);
  assert.equal(columns.executionGeneration.default, 1);
  assert.equal(columns.fencingGeneration.default, 1);

  for (const key of [
    "executionProvider",
    "executionRef",
    "runnerNodeId",
    "runnerKeyVersion",
    "runtimeProfileId",
    "runtimeProfileDigest",
    "channelRef",
    "executionGeneration",
    "fencingGeneration",
    "runnerCommandId",
    "runnerMessageId",
    "runnerMessageDigest",
    "runnerMessageProjection",
    "runnerLeaseOwner",
    "runnerLeaseExpiresAt",
    "taskDefinitionArn",
  ] as const) {
    assert.equal(key in insertShape, false, `${key} must stay server-owned`);
  }
});

test("Runner session schema fences invalid or replayable bindings", () => {
  const config = getTableConfig(previewSessionsTable);
  const checks = new Set(config.checks.map(({ name }) => name));
  const indexes = new Set(config.indexes.map(({ config }) => config.name));

  for (const name of [
    "chk_preview_sessions_execution_provider",
    "chk_preview_sessions_execution_generation_positive",
    "chk_preview_sessions_provider_binding",
    "chk_preview_sessions_local_execution_ref_ready",
    "chk_preview_sessions_runner_message_pair",
    "chk_preview_sessions_runner_lease_pair",
  ]) {
    assert.ok(checks.has(name), `missing ${name}`);
  }

  for (const name of [
    "uq_preview_sessions_execution_provider_ref",
    "uq_preview_sessions_runner_command_id",
    "uq_preview_sessions_runner_message_id",
    "idx_preview_sessions_runner_lease",
  ]) {
    assert.ok(indexes.has(name), `missing ${name}`);
  }
});
