import { describe, expect, it } from "vitest";
import {
  createStrategyReplayCaseRunLease,
  decideStrategyReplayCaseLeaseClaim,
  STRATEGY_REPLAY_CASE_LEASE_RECLAIM_GRACE_MS,
  STRATEGY_REPLAY_CASE_LEGACY_STALE_MS,
} from "./strategy-replay-case-lease.js";

describe("Strategy Replay case-run lease claims", () => {
  const now = new Date("2026-10-03T12:00:00.000Z");
  const ownerToken = "00000000-0000-4000-8000-000000000001";

  it("keeps an active lease busy even when its update timestamp is old", () => {
    const receipt = createStrategyReplayCaseRunLease({
      ownerToken,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    expect(decideStrategyReplayCaseLeaseClaim({
      status: "running",
      receipt,
      updatedAt: new Date(now.getTime() - 60 * 60_000),
      now,
    })).toBe("busy");
  });

  it("reclaims an expired lease only after the grace window", () => {
    const stillWithinGrace = createStrategyReplayCaseRunLease({
      ownerToken,
      expiresAt: new Date(now.getTime() - STRATEGY_REPLAY_CASE_LEASE_RECLAIM_GRACE_MS + 1),
    });
    const pastGrace = createStrategyReplayCaseRunLease({
      ownerToken,
      expiresAt: new Date(now.getTime() - STRATEGY_REPLAY_CASE_LEASE_RECLAIM_GRACE_MS - 1),
    });

    expect(decideStrategyReplayCaseLeaseClaim({
      status: "running",
      receipt: stillWithinGrace,
      updatedAt: new Date(now.getTime() - 60_000),
      now,
    })).toBe("busy");
    expect(decideStrategyReplayCaseLeaseClaim({
      status: "running",
      receipt: pastGrace,
      updatedAt: new Date(now.getTime() - 60_000),
      now,
    })).toBe("reclaim");
  });

  it("waits for legacy running rows to become stale before reclaiming them", () => {
    expect(decideStrategyReplayCaseLeaseClaim({
      status: "running",
      receipt: null,
      updatedAt: new Date(now.getTime() - STRATEGY_REPLAY_CASE_LEGACY_STALE_MS + 1),
      now,
    })).toBe("busy");
    expect(decideStrategyReplayCaseLeaseClaim({
      status: "running",
      receipt: null,
      updatedAt: new Date(now.getTime() - STRATEGY_REPLAY_CASE_LEGACY_STALE_MS),
      now,
    })).toBe("reclaim");
  });

  it("fails closed on unknown non-null running receipts", () => {
    expect(decideStrategyReplayCaseLeaseClaim({
      status: "running",
      receipt: { proof: "unrecognized" },
      updatedAt: new Date(now.getTime() - 24 * 60 * 60_000),
      now,
    })).toBe("invalid");
  });

  it("never claims a terminal incomplete row as running work", () => {
    expect(decideStrategyReplayCaseLeaseClaim({
      status: "incomplete",
      receipt: { status: "incomplete" },
      updatedAt: new Date(now.getTime() - 24 * 60 * 60_000),
      now,
    })).toBe("terminal");
  });
});