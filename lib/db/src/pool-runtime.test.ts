import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  attachDatabasePoolErrorHandler,
  DEFAULT_DATABASE_POOL_MAX,
  parseDatabasePoolMax,
  readDatabasePoolMetrics,
  type DatabasePoolErrorDetails,
} from "./pool-runtime.js";

describe("database pool runtime", () => {
  it("uses the pg-pool default when no per-process budget is configured", () => {
    assert.equal(parseDatabasePoolMax(undefined), DEFAULT_DATABASE_POOL_MAX);
    assert.equal(DEFAULT_DATABASE_POOL_MAX, 10);
  });

  it("accepts a configured positive integer connection budget", () => {
    assert.equal(parseDatabasePoolMax("4"), 4);
  });

  it("reports active, idle, waiting, and maximum clients without interpreting pressure", () => {
    assert.deepEqual(readDatabasePoolMetrics({
      totalCount: 4,
      idleCount: 1,
      waitingCount: 3,
    }, 4), {
      activeClients: 3,
      idleClients: 1,
      waitingRequests: 3,
      maxClients: 4,
    });
  });

  it("rejects invalid connection budgets before creating a pool", () => {
    for (const value of ["", "0", "-1", "1.5", "NaN", "9007199254740992"]) {
      assert.throws(
        () => parseDatabasePoolMax(value),
        /DATABASE_POOL_MAX must be a positive integer/,
        `expected ${JSON.stringify(value)} to be rejected`,
      );
    }
  });

  it("handles idle client errors and reports only safe error metadata", () => {
    const pool = new EventEmitter();
    const reports: Array<{ message: string; details: DatabasePoolErrorDetails }> = [];
    attachDatabasePoolErrorHandler(pool, (message, details) => {
      reports.push({ message, details });
    });

    const error = Object.assign(
      new Error("postgres://user:secret@database.internal/engineering"),
      { code: "ECONNRESET" },
    );
    assert.doesNotThrow(() => pool.emit("error", error));
    assert.deepEqual(reports, [{
      message: "Database pool idle client error",
      details: { errorName: "Error", errorCode: "ECONNRESET" },
    }]);
  });
});
