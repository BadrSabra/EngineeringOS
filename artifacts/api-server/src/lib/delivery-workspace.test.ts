import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createDeliveryWorkspace,
  captureCleanGitSourceCommitSha,
  discardDeliveryWorkspace,
  hashChangeSet,
  hashDeliveryTree,
  resolveWorkspaceTreeRevision,
  WORKSPACE_TREE_REVISION_PREFIX,
  DELIVERY_TREE_DIGEST_VERSION,
  transitionDeliveryLifecycle,
  atomicallyPromoteFile,
  recoverPromotion,
  writeDeliveryWorkspaceFile,
  deliveryWorkspacePath,
} from "./delivery-workspace.js";

describe("delivery workspaces", () => {
  it("captures only the immutable HEAD of a clean Git source", async () => {
    const fixture = `/tmp/delivery-git-source-${randomUUID()}`;
    await mkdir(fixture, { recursive: true });
    try {
      execFileSync("git", ["-C", fixture, "init", "--quiet"]);
      execFileSync("git", ["-C", fixture, "config", "user.name", "Test Fixture"]);
      execFileSync("git", ["-C", fixture, "config", "user.email", "fixture@example.invalid"]);
      await writeFile(join(fixture, "source.txt"), "tracked source\n");
      execFileSync("git", ["-C", fixture, "add", "--", "source.txt"]);
      execFileSync("git", ["-C", fixture, "commit", "--quiet", "-m", "fixture"]);

      const capturedSha = await captureCleanGitSourceCommitSha(fixture);
      expect(capturedSha?.commitSha).toMatch(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
      expect(capturedSha?.projectRootRelativePath).toBe(".");
      await writeFile(join(fixture, "source.txt"), "changed source\n");
      await expect(captureCleanGitSourceCommitSha(fixture)).resolves.toBeNull();
      await writeFile(join(fixture, "source.txt"), "tracked source\n");
      await expect(captureCleanGitSourceCommitSha(fixture)).resolves.toEqual(capturedSha);
      await writeFile(join(fixture, "untracked.txt"), "untracked\n");
      await expect(captureCleanGitSourceCommitSha(fixture)).resolves.toBeNull();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

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
      await expect(readFile(join(workspace.workspaceRoot, "proposal-omitted.ts"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      expect(hashChangeSet([{ path: "app.ts", newContent: "x" }]))
        .toBe(hashChangeSet([{ path: "app.ts", newContent: "x" }]));
      await expect(discardDeliveryWorkspace(workspace.workspaceRoot, operationId)).resolves.toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("uses one deterministic tree contract for source and candidate roots", async () => {
    const fixture = `/tmp/delivery-tree-${randomUUID()}`;
    const operationId = randomUUID();
    await mkdir(join(fixture, "empty"), { recursive: true });
    await writeFile(join(fixture, "bytes.bin"), Buffer.from([0, 1, 255]));
    await writeFile(join(fixture, "target.txt"), "target\n");
    await symlink("target.txt", join(fixture, "link.txt"));
    await writeFile(join(fixture, ".gitignore"), "ignored\n");
    try {
      const baseHash = await hashDeliveryTree(fixture);
      const workspaceRevision = await resolveWorkspaceTreeRevision(fixture);
      const workspace = await createDeliveryWorkspace({
        rootPath: fixture,
        operationId,
        baseRevision: "base-1",
        changes: [],
      });
      expect(workspace.baseTreeHash).toBe(baseHash);
      expect(workspace.candidateTreeHash).toBe(baseHash);
      expect(WORKSPACE_TREE_REVISION_PREFIX).toBe("workspace-tree-v1:");
      expect(workspaceRevision).toBe(`${WORKSPACE_TREE_REVISION_PREFIX}${baseHash}`);
      expect(DELIVERY_TREE_DIGEST_VERSION).toBe("delivery-tree-v1");
      await writeFile(join(fixture, ".engineeringos-delivery-runtime.sock"), "ignored");
      expect(await hashDeliveryTree(fixture)).toBe(baseHash);
      await expect(discardDeliveryWorkspace(workspace.workspaceRoot, operationId)).resolves.toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a tree digest when a file changes during its read", async () => {
    const fixture = `/tmp/delivery-tree-changing-${randomUUID()}`;
    const target = join(fixture, "source.txt");
    await mkdir(fixture, { recursive: true });
    await writeFile(target, "before\n");
    try {
      await expect(hashDeliveryTree(fixture, {
        beforeFileRead: async (relativePath) => {
          if (relativePath === "source.txt") await writeFile(target, "changed during digest\n");
        },
      })).rejects.toMatchObject({ code: "DELIVERY_TREE_CHANGED_DURING_SCAN" });
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

  it("does not follow a candidate symlink when overlaying approved bytes", async () => {
    const fixture = `/tmp/delivery-symlink-${randomUUID()}`;
    const outside = `/tmp/delivery-symlink-outside-${randomUUID()}`;
    const operationId = randomUUID();
    await mkdir(fixture, { recursive: true });
    await mkdir(outside, { recursive: true });
    try {
      await expect(createDeliveryWorkspace({
        rootPath: fixture,
        operationId,
        baseRevision: "base-1",
        changes: [],
      })).resolves.toMatchObject({ lifecycle: "isolated" });
      const workspaceRoot = deliveryWorkspacePath(operationId);
      await symlink(outside, join(workspaceRoot, "escape"));
      await expect(writeDeliveryWorkspaceFile(
        workspaceRoot,
        "escape/payload.txt",
        "must-not-write\n",
      )).rejects.toThrow(/symbolic link|outside isolated workspace/i);
      await expect(readFile(join(outside, "payload.txt"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(deliveryWorkspacePath(operationId), {
        recursive: true,
        force: true,
      });
    }
  });

  it("keeps a write inside the pinned candidate directory after its path is replaced", async () => {
    const fixture = `/tmp/delivery-parent-swap-${randomUUID()}`;
    const outside = `/tmp/delivery-parent-swap-outside-${randomUUID()}`;
    const operationId = randomUUID();
    await mkdir(fixture, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "payload.txt"), "external\n");
    try {
      const workspace = await createDeliveryWorkspace({
        rootPath: fixture,
        operationId,
        baseRevision: "base-1",
        changes: [{ path: "nested/payload.txt", newContent: "candidate base\n" }],
      });
      const workspaceRoot = workspace.workspaceRoot;
      await writeDeliveryWorkspaceFile(
        workspaceRoot,
        "nested/payload.txt",
        "pinned write\n",
        {
          afterParentPinned: async () => {
            await rename(join(workspaceRoot, "nested"), join(workspaceRoot, "nested-held"));
            await symlink(outside, join(workspaceRoot, "nested"));
          },
        },
      );

      await expect(readFile(join(outside, "payload.txt"), "utf8")).resolves.toBe("external\n");
      await expect(readFile(join(workspaceRoot, "nested-held", "payload.txt"), "utf8"))
        .resolves.toBe("pinned write\n");
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(deliveryWorkspacePath(operationId), { recursive: true, force: true });
    }
  });

  it("fails closed when interrupted promotion traverses a live-root symlink", async () => {
    const fixture = `/tmp/delivery-recovery-symlink-${randomUUID()}`;
    const outside = `/tmp/delivery-recovery-outside-${randomUUID()}`;
    const operationId = randomUUID();
    await mkdir(fixture, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "payload.txt"), "base\n", "utf8");
    try {
      await symlink(outside, join(fixture, "escape"));
      await expect(recoverPromotion({
        rootPath: fixture,
        operationId,
        changes: [{
          path: "escape/payload.txt",
          originalContent: "base\n",
          newContent: "must-not-write\n",
        }],
      })).resolves.toBe("RECOVERY_REQUIRED");
      await expect(readFile(join(outside, "payload.txt"), "utf8")).resolves.toBe("base\n");
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
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

  it("refuses to replace an existing file whose bytes differ from the validated base", async () => {
    const fixture = `/tmp/delivery-promotion-conflict-${randomUUID()}`;
    const target = join(fixture, "service.ts");
    await mkdir(fixture, { recursive: true });
    await writeFile(target, "user edit\n", "utf8");
    try {
      await expect(atomicallyPromoteFile(
        target,
        "candidate\n",
        randomUUID(),
        { expectedCurrent: Buffer.from("validated base\n") },
      )).rejects.toMatchObject({ code: "DELIVERY_TARGET_CHANGED" });
      await expect(readFile(target, "utf8")).resolves.toBe("user edit\n");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("does not overwrite a file created at a previously absent target", async () => {
    const fixture = `/tmp/delivery-promotion-create-conflict-${randomUUID()}`;
    const target = join(fixture, "new.ts");
    await mkdir(fixture, { recursive: true });
    await writeFile(target, "created by another writer\n", "utf8");
    try {
      await expect(atomicallyPromoteFile(
        target,
        "candidate\n",
        randomUUID(),
        { expectedCurrent: null },
      )).rejects.toMatchObject({ code: "DELIVERY_TARGET_CHANGED" });
      await expect(readFile(target, "utf8")).resolves.toBe("created by another writer\n");
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