import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createStartupMaintenanceGate } from "./startup-maintenance-gate.js";

describe("startup maintenance API gate", () => {
  it("blocks business routes until historical maintenance is complete", async () => {
    const app = express();
    app.use(
      createStartupMaintenanceGate(() => ({
        status: "blocked",
        reason: "historical_maintenance_in_progress",
      })),
    );
    app.get("/private-data", (_req, res) => res.json({ secret: "not served" }));

    const response = await request(app).get("/private-data");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "blocked",
      error: "startup_maintenance_in_progress",
    });
  });

  it("passes requests after maintenance completes", async () => {
    const app = express();
    app.use(createStartupMaintenanceGate(() => ({ status: "ready" })));
    app.get("/private-data", (_req, res) => res.json({ status: "available" }));

    const response = await request(app).get("/private-data");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "available" });
  });
});
