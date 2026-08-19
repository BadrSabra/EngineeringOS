import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuditSchemaError,
  assertAuditOutboxSchemaWithClient,
} from "./audit-schema-check.js";

const remediation =
  "pnpm --filter @workspace/db run push";

type Fixture = {
  tableExists?: boolean;
  columns?: string[];
  indexExists?: boolean;
};

function clientFor(fixture: Fixture) {
  return {
    async query<T extends Record<string, unknown>>(
      sql: string,
    ): Promise<{ rows: T[]; rowCount: number }> {
      if (sql.includes("information_schema.tables")) {
        return {
          rows: [{ exists: fixture.tableExists ?? true } as T],
          rowCount: 1,
        };
      }
      if (sql.includes("information_schema.columns")) {
        return {
          rows: (fixture.columns ?? [
            "id",
            "row",
            "attempts",
            "next_attempt_at",
            "created_at",
          ]).map((column_name) => ({ column_name }) as T),
          rowCount: fixture.columns?.length ?? 5,
        };
      }
      if (sql.includes("pg_indexes")) {
        return {
          rows: fixture.indexExists === false ? [] : [{ indexname: "idx_pending_audit_logs_next_attempt_at" } as T],
          rowCount: fixture.indexExists === false ? 0 : 1,
        };
      }
      throw new Error(`Unexpected schema query: ${sql}`);
    },
  };
}

async function expectSchemaError(fixture: Fixture, expected: string) {
  await assert.rejects(
    assertAuditOutboxSchemaWithClient(clientFor(fixture)),
    (error: unknown) => {
      assert.ok(error instanceof AuditSchemaError);
      assert.match(error.message, new RegExp(expected));
      assert.match(error.message, new RegExp(remediation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(error.message, /restart the API/);
      return true;
    },
  );
}

describe("audit outbox schema checks", () => {
  it("reports a missing table with an actionable remediation", async () => {
    await expectSchemaError(
      { tableExists: false },
      "Missing required table public\\.pending_audit_logs",
    );
  });

  it("reports missing required columns with an actionable remediation", async () => {
    await expectSchemaError(
      { columns: ["id", "row", "created_at"] },
      "columns: attempts, next_attempt_at",
    );
  });

  it("reports a missing required index with an actionable remediation", async () => {
    await expectSchemaError(
      { indexExists: false },
      "index: idx_pending_audit_logs_next_attempt_at",
    );
  });

  it("accepts the complete required schema", async () => {
    await assert.doesNotReject(
      assertAuditOutboxSchemaWithClient(clientFor({})),
    );
  });
});