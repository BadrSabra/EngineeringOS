import { describe, expect, it } from "vitest";
import { getToolSurfaceCatalog, isToolSurfaceReady } from "../tool-surface.js";

describe("tool surface contract", () => {
  it("requires every registered capability to carry server-side execution guarantees", () => {
    for (const entry of getToolSurfaceCatalog()) {
      expect(entry.serverAuthorized).toBe(true);
      expect(entry.traceable).toBe(true);
      expect(entry.resumable).toBe(true);
      expect(entry.revisionBound).toBe(true);
      expect(entry.verifiable).toBe(true);
    }
  });

  it("does not expose adapter-required integrations before an implementation exists", () => {
    expect(isToolSurfaceReady("symbol_search")).toBe(true);
    expect(isToolSurfaceReady("database")).toBe(false);
    expect(getToolSurfaceCatalog().find((entry) => entry.family === "database")?.exposedToModel).toBe(false);
  });
});