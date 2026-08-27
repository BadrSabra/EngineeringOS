import { describe, expect, it, vi } from "vitest";
import {
  findMissingDatabaseColumns,
  getMissingDatabaseColumns,
} from "./database-schema-preflight";

describe("database schema preflight", () => {
  it("reports the task remediation contract when its column is missing", () => {
    expect(
      findMissingDatabaseColumns([
        { table_name: "projects", column_name: "id" },
        { table_name: "ai_executions", column_name: "operation_id" },
      ]),
    ).toEqual(["tasks.remediation_plan"]);
  });

  it("passes when all critical columns are present", () => {
    expect(
      findMissingDatabaseColumns([
        { table_name: "projects", column_name: "id" },
        { table_name: "ai_executions", column_name: "operation_id" },
        { table_name: "tasks", column_name: "remediation_plan" },
      ]),
    ).toEqual([]);
  });

  it("queries only the allowlisted critical schema contract", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { table_name: "projects", column_name: "id" },
        { table_name: "ai_executions", column_name: "operation_id" },
        { table_name: "tasks", column_name: "remediation_plan" },
      ],
    });

    await expect(getMissingDatabaseColumns({ query })).resolves.toEqual([]);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("remediation_plan");
  });
});