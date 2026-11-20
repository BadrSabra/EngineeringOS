import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { aiWorldTransitionsTable } from "./ai_world_transitions.js";

test("global World Transition recovery uses a partial ordered index", () => {
  const tableConfig = getTableConfig(aiWorldTransitionsTable);
  const recoveryIndex = tableConfig.indexes.find(
    (index) => index.config.name === "idx_ai_world_transitions_global_recovery",
  );

  assert.ok(recoveryIndex, "the global World Transition recovery index must be declared");
  const columnNames = recoveryIndex.config.columns.map((column) => {
    if (typeof column !== "object" || column === null || !("name" in column)) {
      return null;
    }
    return (column as { name?: unknown }).name;
  });

  assert.deepEqual(columnNames, ["created_at", "id"]);
  assert.ok(
    recoveryIndex.config.where,
    "completed and terminal-failed transitions must be excluded from the recovery index",
  );
});
