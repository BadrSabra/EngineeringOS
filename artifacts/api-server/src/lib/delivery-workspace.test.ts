import { describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createDeliveryWorkspace,
  discardDeliveryWorkspace,
  hashChangeSet,
  transitionDeliveryLifecycle,
} from "./delivery-workspace.js";

describe("delivery workspaces", () => {
  it("creates an operation-owned copy and overlays only the approved change set", async () => {
    const fixture = `/tmp/delivery-fixture-${randomUUID()}`;
    const operationId = randomUUID();
    await mkdir(fixture, { recursive: true });
    await writeFile(join(fixture, "app.ts"), "export const value = 1;\n");
    try {
      const workspace = await createDeliveryWorkspace({
        rootPath: fixture,
        operationId,
        baseRevision: "base-1",
        changes: [{ path: "app.ts", newContent: "export const value = 2;\n" }],
      });
      expect(workspace.lifecycle).toBe("isolated");
      expect(workspace.workspaceRoot).not.toBe(fixture);
      await expect(readFile(join(workspace.workspaceRoot, "app.ts"), "utf8"))
        .resolves.toBe("export const value = 2;\n");
      expect(hashChangeSet([{ path: "app.ts", newContent: "x" }]))
        .toBe(hashChangeSet([{ path: "app.ts", newContent: "x" }]));
      await expect(discardDeliveryWorkspace(workspace.workspaceRoot, operationId)).resolves.toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects unsafe cleanup and impossible lifecycle jumps", async () => {
    const operationId = randomUUID();
    await expect(discardDeliveryWorkspace("/tmp/not-owned", operationId)).resolves.toBe(false);
    expect(transitionDeliveryLifecycle("proposed", "isolated")).toBe(true);
    expect(transitionDeliveryLifecycle("isolated", "committed")).toBe(false);
    expect(transitionDeliveryLifecycle("committed", "isolated")).toBe(false);
  });
});