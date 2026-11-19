import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: databaseMock.select },
}));

import {
  resolveRetryDeadlineFromDatabaseClock,
  retryDeadlineFromDatabaseTime,
} from "./database-retry-deadline.js";

describe("structured retry deadlines", () => {
  beforeEach(() => {
    databaseMock.select.mockReset();
    databaseMock.select.mockReset();
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
    databaseMock.select.mockResolvedValueOnce([{
      databaseNow: new Date("2026-11-19T12:00:00.000Z"),
    }]);

    await expect(resolveRetryDeadlineFromDatabaseClock(30_000))
      .resolves.toBe("2026-11-19T12:00:30.000Z");
    expect(databaseMock.select).toHaveBeenCalledTimes(1);
    expect(databaseMock.select).toHaveBeenCalledWith({
      databaseNow: expect.anything(),
    });
  });

  it("does not issue a database query for an invalid delay", async () => {
    await expect(resolveRetryDeadlineFromDatabaseClock(0)).resolves.toBeUndefined();
    expect(databaseMock.select).not.toHaveBeenCalled();
  });

  it("fails closed when the database clock cannot produce a deadline", async () => {
    databaseMock.select.mockResolvedValueOnce([]);
    await expect(resolveRetryDeadlineFromDatabaseClock(1_000))
      .rejects.toThrow("DATABASE_CLOCK_UNAVAILABLE");
  });
});
