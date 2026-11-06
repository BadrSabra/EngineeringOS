/**
 * Tests for health.ts: GET /healthz.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { workspaceRuntime } from "../lib/workspace-runtime.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.unresolvedRuntimeStart).toMatchObject({
      status: expect.stringMatching(/^(clear|alert)$/),
      thresholdMs: expect.any(Number),
      unresolvedCount: expect.any(Number),
    });
    expect(
      res.body.unresolvedRuntimeStart.oldestAgeMs === null
      || typeof res.body.unresolvedRuntimeStart.oldestAgeMs === "number",
    ).toBe(true);
    expect(res.body.jobRecovery).toMatchObject({
      status: expect.stringMatching(/^(healthy|degraded)$/),
      queuedScanJobs: expect.any(Number),
      pendingDiscoverySessions: expect.any(Number),
      staleQueuedScanJobs: expect.any(Number),
      stalePendingDiscoverySessions: expect.any(Number),
    });
    expect(res.body.aiDiagnosticsRetention).toHaveProperty("status");
    expect(res.body.aiDiagnosticsRetention).toHaveProperty("attemptedAt");
    expect(res.body.aiDiagnosticsRetention).toHaveProperty("completedAt");
    expect(res.body.operationalCounters.agentEpisodeShadow).toMatchObject({
      writes: expect.any(Number),
      successes: expect.any(Number),
      failures: expect.any(Number),
    });
    expect(res.body.operationalCounters.agentEpisodeShadow).toHaveProperty("p95LatencyMs");
    for (const key of [
      "chatRowsScanned",
      "chatRowsPruned",
      "executionRowsScanned",
      "executionRowsPruned",
    ]) {
      expect(res.body.aiDiagnosticsRetention[key]).toEqual(expect.any(Number));
    }
  });

  it("is accessible without auth (health checks must never be gated)", async () => {
    // /api/healthz is registered before requireAuth in app.ts —
    // this test confirms it never returns 401 regardless of missing credentials.
    const res = await request(app).get("/api/healthz");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("surfaces the unresolved-start alert without changing health liveness", async () => {
    vi.spyOn(workspaceRuntime, "getUnresolvedStartHealth").mockResolvedValue({
      status: "alert",
      thresholdMs: 60_000,
      unresolvedCount: 2,
      oldestAgeMs: 90_000,
    });

    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.unresolvedRuntimeStart).toEqual({
      status: "alert",
      thresholdMs: 60_000,
      unresolvedCount: 2,
      oldestAgeMs: 90_000,
    });
  });
});
