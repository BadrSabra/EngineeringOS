import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createReadinessHandler } from "./health.js";

describe("GET /readiness", () => {
  it("declares ready only when the complete schema and maintenance are ready", async () => {
    const app = express();
    app.get(
      "/readiness",
      createReadinessHandler(
        async () => ({ status: "ready", checkedAt: "2026-11-06T00:00:00.000Z" }),
        () => ({ status: "ready" }),
      ),
    );

    const response = await request(app).get("/readiness");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ready",
      checks: {
        schema: { status: "ready" },
        maintenance: { status: "ready" },
      },
    });
  });

  it("returns sanitized blockers for schema drift or unfinished maintenance", async () => {
    const app = express();
    app.get(
      "/readiness",
      createReadinessHandler(
        async () => ({
          status: "blocked",
          reason: "schema_incomplete",
          issueCount: 3,
          checkedAt: "2026-11-06T00:00:00.000Z",
        }),
        () => ({
          status: "blocked",
          reason: "historical_maintenance_in_progress",
        }),
      ),
    );

    const response = await request(app).get("/readiness");
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: "blocked",
      checks: {
        schema: { status: "blocked", reason: "schema_incomplete", issueCount: 3 },
        maintenance: { status: "blocked" },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("internal column name");
  });
});
