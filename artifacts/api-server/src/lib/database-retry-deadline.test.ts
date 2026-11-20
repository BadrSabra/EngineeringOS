import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const databaseMock = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: databaseMock.execute },
}));

import {
  resolveRetryDeadlineFromDatabaseClock,
  retryDeadlineFromDatabaseTime,
} from "./database-retry-deadline.js";

describe("structured retry deadlines", () => {
  beforeEach(() => {
    databaseMock.execute.mockReset();
  });

  it("derives the absolute deadline from the supplied database instant", () => {
    expect(retryDeadlineFromDatabaseTime(
      new Date("2026-11-19T12:00:00.000Z"),
      15_001,
    )).toBe("2026-11-19T12:00:15.001Z");
  });

  it("rejects invalid clocks and non-positive or unsafe durations", () => {
    expect(retryDeadlineFromDatabaseTime(new Date(Number.NaN), 1_000)).toBeUndefined();
    expect(retryDeadlineFromDatabaseTime(new Date("2026-11-19T12:00:00.000Z"), 0)).toBeUndefined();
    expect(retryDeadlineFromDatabaseTime(new Date("2026-11-19T12:00:00.000Z"), Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(retryDeadlineFromDatabaseTime(new Date("2026-11-19T12:00:00.000Z"), Number.MAX_VALUE)).toBeUndefined();
  });

  it("reads PostgreSQL time before constructing a retry deadline", async () => {
    databaseMock.execute.mockResolvedValueOnce({
      rows: [{ databaseNow: new Date("2026-11-19T12:00:00.000Z") }],
    });

    await expect(resolveRetryDeadlineFromDatabaseClock(30_000))
      .resolves.toBe("2026-11-19T12:00:30.000Z");
    expect(databaseMock.execute).toHaveBeenCalledTimes(1);
    const query = databaseMock.execute.mock.calls[0]?.[0];
    expect(new PgDialect().sqlToQuery(query).sql).toContain("clock_timestamp()");
  });

  it("does not issue a database query for an invalid delay", async () => {
    await expect(resolveRetryDeadlineFromDatabaseClock(0)).resolves.toBeUndefined();
    expect(databaseMock.execute).not.toHaveBeenCalled();
  });

  it("fails closed when the database clock cannot produce a deadline", async () => {
    databaseMock.execute.mockResolvedValueOnce({ rows: [] });
    await expect(resolveRetryDeadlineFromDatabaseClock(1_000))
      .rejects.toThrow("DATABASE_CLOCK_UNAVAILABLE");
  });
});
