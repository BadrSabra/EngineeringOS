import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import type { OpenRouterCatalogSnapshot } from "@workspace/ai-orchestrator";
import { createOpenRouterCatalogPersistence } from "./openrouter-catalog-persistence.js";

const LEASE_ACQUIRE_WAIT_MS = 250;

let workerA: ReturnType<typeof createOpenRouterCatalogPersistence>;
let workerB: ReturnType<typeof createOpenRouterCatalogPersistence>;
let releaseSessionA: (() => void) | undefined;
let releaseSessionB: (() => void) | undefined;

const snapshot: OpenRouterCatalogSnapshot = {
  version: 1,
  freeModels: [{
    id: "fixture/free-model",
    supportsJsonObject: true,
    supportsJsonSchema: false,
  }],
  paidModels: [],
  paidPolicyFingerprint: "isolated-postgres-fixture",
};

beforeAll(async () => {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl || new URL(rawDatabaseUrl).hostname !== "127.0.0.1") {
    throw new Error(
      "OpenRouter catalog persistence integration requires a disposable loopback DATABASE_URL.",
    );
  }
  const [sessionA, sessionB] = await Promise.all([pool.connect(), pool.connect()]);
  workerA = createOpenRouterCatalogPersistence(sessionA);
  workerB = createOpenRouterCatalogPersistence(sessionB);
  releaseSessionA = () => sessionA.release();
  releaseSessionB = () => sessionB.release();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE openrouter_catalog_snapshots");
});

afterAll(async () => {
  await pool.query("TRUNCATE TABLE openrouter_catalog_snapshots");
  releaseSessionA?.();
  releaseSessionB?.();
  await pool.end();
});

describe("PostgreSQL OpenRouter catalog persistence", () => {
  it("grants a concurrent refresh lease to only one worker", async () => {
    const [leaseA, leaseB] = await Promise.all([
      workerA.acquireRefreshLease(LEASE_ACQUIRE_WAIT_MS, 5_000),
      workerB.acquireRefreshLease(LEASE_ACQUIRE_WAIT_MS, 5_000),
    ]);

    expect([leaseA, leaseB].filter(Boolean)).toHaveLength(1);

    await leaseA?.release();
    await leaseB?.release();
  });

  it("fences an expired lease owner and exposes the replacement snapshot", async () => {
    const staleLease = await workerA.acquireRefreshLease(LEASE_ACQUIRE_WAIT_MS, 1_000);
    expect(staleLease).toBeDefined();
    if (!staleLease) throw new Error("The initial worker did not acquire the lease.");

    let replacementLease: Awaited<ReturnType<typeof workerB.acquireRefreshLease>>;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      replacementLease = await workerB.acquireRefreshLease(LEASE_ACQUIRE_WAIT_MS, 5_000);
      expect(replacementLease).toBeDefined();
      if (!replacementLease) {
        throw new Error("The replacement worker did not acquire the expired lease.");
      }

      await expect(staleLease.commitSnapshot(snapshot, 30_000))
        .rejects.toThrow("OpenRouter catalog refresh lease expired before its write");

      await replacementLease.commitSnapshot(snapshot, 30_000);
      await expect(workerA.read()).resolves.toMatchObject({
        snapshot,
        lastFailureCode: null,
        failureBackoffUntilMs: null,
      });
    } finally {
      await staleLease.release();
      await replacementLease?.release();
    }
  });

  it("shares provider failure backoff across persistence instances", async () => {
    const lease = await workerA.acquireRefreshLease(LEASE_ACQUIRE_WAIT_MS, 5_000);
    expect(lease).toBeDefined();
    if (!lease) throw new Error("The worker did not acquire the refresh lease.");

    try {
      await lease.recordFailure("RATE_LIMITED", 30_000);
    } finally {
      await lease.release();
    }

    const state = await workerB.read();
    expect(state?.lastFailureCode).toBe("RATE_LIMITED");
    expect(state?.failureBackoffUntilMs).toBeGreaterThan(Date.now());
  });
});
