import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { graphRelationshipsTable } from "./graph.js";

test("runtime-observed graph reads use a project-scoped composite index", () => {
  const tableConfig = getTableConfig(graphRelationshipsTable);
  const runtimeIndex = tableConfig.indexes.find(
    (index) => index.config.name === "idx_graph_rels_project_runtime_observed",
  );

  assert.ok(runtimeIndex, "the runtime observation index must be declared");
  const columnNames = runtimeIndex.config.columns.map((column) => {
    if (typeof column !== "object" || column === null || !("name" in column)) {
      return null;
    }
    return (column as { name?: unknown }).name;
  });
  assert.deepEqual(columnNames, ["project_id", "is_runtime_observed"]);
});
