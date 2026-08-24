import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  MANAGED_PROJECT_ROOTS_DIR,
  managedProjectRootForSession,
  materializeProjectRoot,
  removeManagedProjectRoot,
} from "./project-materialization.js";

const fixtureBase = `/home/runner/workspace/.test-roots/materialization-${randomUUID()}`;
const sourceRoot = join(fixtureBase, "source");

beforeAll(async () => {
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, "package.json"), "{}\n");
  await writeFile(join(sourceRoot, "README.md"), "durable fixture\n");
});

afterAll(async () => {
  await rm(fixtureBase, { recursive: true, force: true });
});

describe("project materialization", () => {
  it("copies a temporary source into an app-owned durable root", async () => {
    const sessionId = `test-${randomUUID()}`;
    const durableRoot = await materializeProjectRoot(sourceRoot, sessionId);

    try {
      expect(durableRoot).toBe(managedProjectRootForSession(sessionId));
      expect(durableRoot.startsWith(`${MANAGED_PROJECT_ROOTS_DIR}/`)).toBe(true);
      expect(await readFile(join(durableRoot, "package.json"), "utf8")).toBe("{}\n");
      expect(await readFile(join(durableRoot, "README.md"), "utf8")).toBe("durable fixture\n");
      await expect(readFile(join(durableRoot, ".engineeringos-managed-root"), "utf8"))
        .resolves.toBe("engineeringos-managed-project-root\n");
    } finally {
      expect(await removeManagedProjectRoot(durableRoot)).toBe(true);
    }

    await expect(access(durableRoot)).rejects.toThrow();
  });

  it("does not remove an unmarked user directory even under the managed parent", async () => {
    const userDirectory = managedProjectRootForSession(`user-${randomUUID()}`);
    await mkdir(userDirectory, { recursive: true });
    try {
      expect(await removeManagedProjectRoot(userDirectory)).toBe(false);
      await expect(access(userDirectory)).resolves.toBeUndefined();
    } finally {
      await rm(userDirectory, { recursive: true, force: true });
    }
  });

  it("refuses to remove a caller-owned project root outside managed storage", async () => {
    expect(await removeManagedProjectRoot(sourceRoot)).toBe(false);
    await expect(access(sourceRoot)).resolves.toBeUndefined();
  });
});