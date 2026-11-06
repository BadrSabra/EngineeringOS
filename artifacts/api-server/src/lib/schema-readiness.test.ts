import { describe, expect, it, vi } from "vitest";
import { createSchemaReadinessProbe } from "./schema-readiness.js";

describe("schema readiness probe", () => {
  it("shares concurrent checks and caches the full-contract result", async () => {
    let now = 1_000;
    let resolveCheck: ((value: { reason?: "schema_incomplete" }) => void) | undefined;
    const check = vi.fn(
      () => new Promise<{ reason?: "schema_incomplete" }>((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const probe = createSchemaReadinessProbe(check, {
      ttlMs: 30_000,
      now: () => now,
    });

    const first = probe.read();
    const concurrent = probe.read();
    expect(check).toHaveBeenCalledTimes(1);
    resolveCheck?.({});
    await expect(first).resolves.toMatchObject({ status: "ready" });
    await expect(concurrent).resolves.toMatchObject({ status: "ready" });

    now += 29_999;
    await expect(probe.read()).resolves.toMatchObject({ status: "ready" });
    expect(check).toHaveBeenCalledTimes(1);
    now += 1;
    const nextCheck = probe.read();
    expect(check).toHaveBeenCalledTimes(2);
    resolveCheck?.({ reason: "schema_incomplete" });
    await expect(nextCheck).resolves.toMatchObject({
      status: "blocked",
      reason: "schema_incomplete",
    });
  });

  it("can invalidate a cached result after schema delivery", async () => {
    const check = vi.fn().mockResolvedValue({});
    const probe = createSchemaReadinessProbe(check, { now: () => 5_000 });

    await probe.read();
    probe.invalidate();
    await probe.read();

    expect(check).toHaveBeenCalledTimes(2);
  });
});
