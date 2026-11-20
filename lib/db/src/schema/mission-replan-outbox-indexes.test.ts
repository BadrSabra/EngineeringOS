import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { eventsTable } from "./events.js";

test("Mission replan recovery uses a partial ordered Outbox index", () => {
  const tableConfig = getTableConfig(eventsTable);
  const recoveryIndex = tableConfig.indexes.find(
    (index) => index.config.name === "idx_events_mission_replan_pending",
  );

  assert.ok(recoveryIndex, "the Mission replan recovery index must be declared");
  const columnNames = recoveryIndex.config.columns.map((column) => {
    if (typeof column !== "object" || column === null || !("name" in column)) {
      return null;
    }
    return (column as { name?: unknown }).name;
  });

  assert.deepEqual(columnNames, ["timestamp", "id"]);
  assert.ok(
    recoveryIndex.config.where,
    "terminal Mission replan events must be excluded from the recovery index",
  );
});
