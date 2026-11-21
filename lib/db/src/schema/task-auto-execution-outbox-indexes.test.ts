import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { eventsTable } from "./events.js";

test("Task auto-execution outbox polling uses a partial ordered index", () => {
  const tableConfig = getTableConfig(eventsTable);
  const outboxIndex = tableConfig.indexes.find(
    (index) => index.config.name === "idx_events_task_auto_execution_pending",
  );

  assert.ok(outboxIndex, "the Task auto-execution outbox index must be declared");
  const columnNames = outboxIndex.config.columns.map((column) => {
    if (typeof column !== "object" || column === null || !("name" in column)) {
      return null;
    }
    return (column as { name?: unknown }).name;
  });

  assert.deepEqual(columnNames, ["timestamp", "id"]);
  assert.ok(
    outboxIndex.config.where,
    "the index must exclude unrelated events and cover only Task dispatch intent types",
  );
});
