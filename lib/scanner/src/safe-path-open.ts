import { constants } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Dir } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const PROC_FD_ROOT = "/proc/self/fd";

function descriptorPath(handle: FileHandle): string {
  return join(PROC_FD_ROOT, String(handle.fd));
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

async function assertDescriptorWithinRoot(
  handle: FileHandle,
  rootPath: string,
): Promise<string> {
  const openedPath = await realpath(descriptorPath(handle));
  if (!isWithinRoot(rootPath, openedPath)) {
    throw new Error("Opened filesystem entry resolved outside the project root.");
  }
  return openedPath;
}

function assertSimpleChildName(name: string): void {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\0")
  ) {
    throw new Error("Filesystem child name is invalid.");
  }
}

function assertLinuxProcFs(): void {
  if (process.platform !== "linux") {
    throw new Error("Secure project scanning requires Linux descriptor paths.");
  }
}

export interface OpenedProjectRoot {
  canonicalPath: string;
  handle: FileHandle;
}

export async function openProjectRoot(rootPath: string): Promise<OpenedProjectRoot> {
  assertLinuxProcFs();
  const canonicalPath = await realpath(rootPath);
  const expectedStat = await stat(canonicalPath);
  const handle = await open(
    canonicalPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const [openedPath, rootStat] = await Promise.all([
      realpath(descriptorPath(handle)),
      handle.stat(),
    ]);
    if (
      openedPath !== canonicalPath ||
      !rootStat.isDirectory() ||
      rootStat.dev !== expectedStat.dev ||
      rootStat.ino !== expectedStat.ino
    ) {
      throw new Error("Project root changed while opening the scan.");
    }
    return { canonicalPath, handle };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function openProjectDirectoryCursor(
  directory: FileHandle,
  rootPath: string,
): Promise<Dir> {
  await assertDescriptorWithinRoot(directory, rootPath);
  const cursor = await opendir(descriptorPath(directory));
  try {
    await assertDescriptorWithinRoot(directory, rootPath);
    return cursor;
  } catch (error) {
    await cursor.close().catch(() => undefined);
    throw error;
  }
}

export async function openProjectChildDirectory(
  parent: FileHandle,
  name: string,
  rootPath: string,
): Promise<FileHandle> {
  assertSimpleChildName(name);
  await assertDescriptorWithinRoot(parent, rootPath);
  const child = await open(
    join(descriptorPath(parent), name),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await assertDescriptorWithinRoot(child, rootPath);
    if (!(await child.stat()).isDirectory()) {
      throw new Error("Opened filesystem entry is not a directory.");
    }
    return child;
  } catch (error) {
    await child.close().catch(() => undefined);
    throw error;
  }
}

export async function openProjectChildFile(
  parent: FileHandle,
  name: string,
  rootPath: string,
): Promise<FileHandle> {
  assertSimpleChildName(name);
  await assertDescriptorWithinRoot(parent, rootPath);
  const child = await open(
    join(descriptorPath(parent), name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    await assertDescriptorWithinRoot(child, rootPath);
    if (!(await child.stat()).isFile()) {
      throw new Error("Opened filesystem entry is not a regular file.");
    }
    return child;
  } catch (error) {
    await child.close().catch(() => undefined);
    throw error;
  }
}
