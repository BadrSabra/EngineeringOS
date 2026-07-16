/**
 * Tests for health.ts: GET /healthz.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("is accessible without auth (health checks must never be gated)", async () => {
    // /api/healthz is registered before requireAuth in app.ts —
    // this test confirms it never returns 401 regardless of missing credentials.
    const res = await request(app).get("/api/healthz");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
