import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("Plugin registry", () => {
  it("lists the seeded default plugins", async () => {
    const res = await request(app).get("/api/plugins");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some((p: { id: string }) => p.id === "plugin-react")).toBe(true);
  });

  it("disables and re-enables a plugin", async () => {
    const disabled = await request(app)
      .post("/api/plugins/plugin-react/disable")
      .send({ projectId: "any-project" });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    const enabled = await request(app)
      .post("/api/plugins/plugin-react/enable")
      .send({ projectId: "any-project" });
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);
  });

  it("returns 404 for a nonexistent plugin", async () => {
    const res = await request(app)
      .post("/api/plugins/does-not-exist/enable")
      .send({ projectId: "any-project" });
    expect(res.status).toBe(404);
  });
});
