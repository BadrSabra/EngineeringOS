import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  openVerifiedProjectDirectory,
  openVerifiedProjectFile,
  projectDirectoryDescriptorPath,
} from "../tools/file-tools.js";

describe("verified project file handles", () => {
  it("rejects file and directory paths redirected outside the project", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "project-path-race-"));
    const root = path.join(base, "project");
    const outside = path.join(base, "outside");
    try {
      await fs.mkdir(root);
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "secret.txt"), "outside content");
      await fs.symlink(outside, path.join(root, "linked"));

      await expect(
        openVerifiedProjectFile(root, path.join(root, "linked", "secret.txt")),
      ).rejects.toThrow();
      await expect(
        openVerifiedProjectDirectory(root, path.join(root, "linked")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("keeps a verified file handle bound to the opened inode after path replacement", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "project-file-pin-"));
    const root = path.join(base, "project");
    const outside = path.join(base, "outside");
    const filePath = path.join(root, "source.txt");
    try {
      await fs.mkdir(root);
      await fs.mkdir(outside);
      await fs.writeFile(filePath, "verified original");
      await fs.writeFile(path.join(outside, "source.txt"), "replacement secret");

      const handle = await openVerifiedProjectFile(root, filePath);
      try {
        await fs.rm(filePath);
        await fs.symlink(path.join(outside, "source.txt"), filePath);
        await expect(handle.readFile({ encoding: "utf8" })).resolves.toBe("verified original");
      } finally {
        await handle.close();
      }
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("enumerates the opened directory after its project path is replaced", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "project-directory-pin-"));
    const root = path.join(base, "project");
    const outside = path.join(base, "outside");
    const directoryPath = path.join(root, "source");
    try {
      await fs.mkdir(directoryPath, { recursive: true });
      await fs.mkdir(outside);
      await fs.writeFile(path.join(directoryPath, "original.txt"), "inside");
      await fs.writeFile(path.join(outside, "replacement.txt"), "outside");

      const handle = await openVerifiedProjectDirectory(root, directoryPath);
      try {
        await fs.rename(directoryPath, path.join(root, "source-moved"));
        await fs.symlink(outside, directoryPath);
        const directory = await fs.opendir(projectDirectoryDescriptorPath(handle));
        const names: string[] = [];
        try {
          for await (const entry of directory) names.push(entry.name);
        } finally {
          await directory.close().catch(() => undefined);
        }
        expect(names).toEqual(["original.txt"]);
      } finally {
        await handle.close();
      }
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});