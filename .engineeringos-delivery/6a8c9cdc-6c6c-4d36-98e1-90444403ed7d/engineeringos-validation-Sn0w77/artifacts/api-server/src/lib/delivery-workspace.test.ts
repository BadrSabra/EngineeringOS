import { describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createDeliveryWorkspace,
  discardDeliveryWorkspace,
  hashChangeSet,
  transitionDeliveryLifecycle,
  atomicallyPromoteFile,
  recoverPromotion,
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

  it("recovers a mixed promotion only from exact base bytes", async () => {
    const fixture = `/tmp/delivery-recovery-${randomUUID()}`;
    await mkdir(fixture, { recursive: true });
    try {
      await writeFile(join(fixture, "a.ts"), "new\n");
      await writeFile(join(fixture, "b.ts"), "old\n");
      await atomicallyPromoteFile(join(fixture, "b.ts"), "new\n", randomUUID());
      await expect(readFile(join(fixture, "b.ts"), "utf8")).resolves.toBe("new\n");
      await expect(recoverPromotion({
        rootPath: fixture,
        operationId: randomUUID(),
        changes: [
          { path: "a.ts", originalContent: "old\n", newContent: "new\n" },
          { path: "b.ts", originalContent: "old\n", newContent: "new\n" },
        ],
      })).resolves.toBe("PROMOTED");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("classifies an unexpected live-root edit instead of overwriting it", async () => {
    const fixture = `/tmp/delivery-recovery-${randomUUID()}`;
    await mkdir(fixture, { recursive: true });
    try {
      await writeFile(join(fixture, "a.ts"), "user edit\n");
      await expect(recoverPromotion({
        rootPath: fixture,
        operationId: randomUUID(),
        changes: [{ path: "a.ts", originalContent: "old\n", newContent: "new\n" }],
      })).resolves.toBe("RECOVERY_REQUIRED");
      await expect(readFile(join(fixture, "a.ts"), "utf8")).resolves.toBe("user edit\n");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});