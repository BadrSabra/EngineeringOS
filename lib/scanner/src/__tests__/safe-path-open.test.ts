import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openProjectChildDirectory,
  openProjectChildFile,
  openProjectDirectoryCursor,
  openProjectRoot,
} from "../safe-path-open.js";

const roots: string[] = [];
const handles: Awaited<ReturnType<typeof openProjectRoot>>["handle"][] = [];

async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), "scanner-safe-open-"));
  roots.push(temp);
  const rootPath = join(temp, "project");
  const outsidePath = join(temp, "outside");
  await mkdir(rootPath);
  await mkdir(outsidePath);
  return { temp, rootPath, outsidePath };
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.skipIf(process.platform !== "linux")("descriptor-relative project file access", () => {
  it("rejects a symlink swapped in after directory enumeration", async () => {
    const { rootPath, outsidePath } = await fixture();
    const sourcePath = join(rootPath, "source.ts");
    const outsideFile = join(outsidePath, "secret.ts");
    await writeFile(sourcePath, "inside");
    await writeFile(outsideFile, "outside");

    const root = await openProjectRoot(rootPath);
    handles.push(root.handle);
    const cursor = await openProjectDirectoryCursor(root.handle, root.canonicalPath);
    const entry = await cursor.read();
    await cursor.close();
    expect(entry?.name).toBe("source.ts");

    await rm(sourcePath);
    await symlink(outsideFile, sourcePath);
    await expect(
      openProjectChildFile(root.handle, "source.ts", root.canonicalPath),
    ).rejects.toThrow();
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside");
  });

  it("rejects a directory replaced with a symlink before descent", async () => {
    const { rootPath, outsidePath } = await fixture();
    const childPath = join(rootPath, "src");
    await mkdir(childPath);
    await writeFile(join(outsidePath, "outside.ts"), "outside");

    const root = await openProjectRoot(rootPath);
    handles.push(root.handle);
    const cursor = await openProjectDirectoryCursor(root.handle, root.canonicalPath);
    const entry = await cursor.read();
    await cursor.close();
    expect(entry?.name).toBe("src");

    await rm(childPath, { recursive: true });
    await symlink(outsidePath, childPath, "dir");
    await expect(
      openProjectChildDirectory(root.handle, "src", root.canonicalPath),
    ).rejects.toThrow();
  });

  it("fails closed if the pinned project root is moved outside its established path", async () => {
    const { rootPath, outsidePath, temp } = await fixture();
    const movedRoot = join(temp, "project-moved");
    const root = await openProjectRoot(rootPath);
    handles.push(root.handle);

    await rename(rootPath, movedRoot);
    await symlink(outsidePath, rootPath, "dir");
    await expect(
      openProjectDirectoryCursor(root.handle, root.canonicalPath),
    ).rejects.toThrow(/outside the project root/i);
    await expect(readFile(join(outsidePath, "source.ts"))).rejects.toThrow();
  });
});
