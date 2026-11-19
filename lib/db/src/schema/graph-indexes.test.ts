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
  assert.deepEqual(
    runtimeIndex.config.columns.map((column) => column.name),
    ["project_id", "is_runtime_observed"],
  );
});
