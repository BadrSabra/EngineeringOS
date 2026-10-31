import { afterEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query },
}));

import {
  _setModelCooldownPersistenceForTest,
  acquireModelAttemptLease,
} from "./model-cooldown-store.js";

describe("distributed OpenRouter model attempt lease", () => {
  afterEach(() => {
    _setModelCooldownPersistenceForTest(undefined);
    query.mockReset();
    vi.useRealTimers();
  });

  it("claims and releases an expiring lease in the existing cooldown table", async () => {
    const leaseToken = "2026-10-31T20:00:00.123456Z";
    query
      .mockResolvedValueOnce({ rows: [{ lease_token: leaseToken }] })
      .mockResolvedValueOnce({ rows: [] });

    const lease = await acquireModelAttemptLease("openrouter", "fixture/model");
    expect(lease).toBeDefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT (provider, model) DO UPDATE");
    expect(query.mock.calls[0]?.[0]).toContain(
      "WHERE openrouter_model_cooldowns.cooling_until <= clock_timestamp()",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "openrouter",
      "__attempt_lease__:fixture/model",
      90_000,
    ]);

    await lease!.release();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "openrouter",
      "__attempt_lease__:fixture/model",
      leaseToken,
    ]);
  });

  it("waits for a competing lease only within the bounded wait", async () => {
    vi.useFakeTimers();
    const leaseToken = "2026-10-31T20:00:00.654321Z";
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ lease_token: leaseToken }] })
      .mockResolvedValueOnce({ rows: [] });

    const leasePromise = acquireModelAttemptLease("openrouter", "fixture/model");
    await vi.advanceTimersByTimeAsync(75);
    const lease = await leasePromise;

    expect(lease).toBeDefined();
    expect(query).toHaveBeenCalledTimes(2);
    await lease!.release();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("returns no lease once the bounded admission wait expires", async () => {
    vi.useFakeTimers();
    query.mockResolvedValue({ rows: [] });

    const leasePromise = acquireModelAttemptLease("openrouter", "fixture/busy-model");
    const expectedBusy = expect(leasePromise).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    await expectedBusy;

    expect(query).toHaveBeenCalled();
  });
});
