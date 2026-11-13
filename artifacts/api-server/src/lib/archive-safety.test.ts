import { describe, expect, it, afterEach } from "vitest";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  ArchiveProcessingLimiter,
  ARCHIVE_LIMITS,
  ArchiveSafetyError,
  extractTarGzSafely,
  extractZipSafely,
  validateArchiveEntryPath,
} from "./archive-safety.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function extractionRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "eos-archive-test-"));
  roots.push(root);
  return root;
}

async function tarFrom(entries: Array<{ name: string; content?: string }>): Promise<string> {
  const source = await mkdtemp(join(tmpdir(), "eos-tar-source-"));
  roots.push(source);
  for (const entry of entries) {
    const path = join(source, entry.name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, entry.content ?? "");
  }
  const tarPath = join(source, "archive.tar.gz");
  await execFileAsync("tar", ["-czf", tarPath, "-C", source, ...entries.map((entry) => entry.name)]);
  return tarPath;
}

async function tarWithTransformedMember(memberName: string): Promise<string> {
  const source = await mkdtemp(join(tmpdir(), "eos-tar-path-test-"));
  roots.push(source);
  await writeFile(join(source, "member.ts"), "archive content");
  const tarPath = join(source, "archive.tar.gz");
  await execFileAsync("tar", [
    "-czf",
    tarPath,
    "--absolute-names",
    "--transform",
    `s|^member.ts$|${memberName}|`,
    "-C",
    source,
    "member.ts",
  ]);
  return tarPath;
}

describe("archive extraction safety policy", () => {
  it("bounds concurrent archive parsing and releases capacity exactly once", () => {
    const limiter = new ArchiveProcessingLimiter(1);
    const release = limiter.tryAcquire();
    expect(release).toEqual(expect.any(Function));
    expect(limiter.tryAcquire()).toBeNull();
    release?.();
    release?.();
    const nextRelease = limiter.tryAcquire();
    expect(nextRelease).toEqual(expect.any(Function));
    nextRelease?.();
  });

  it("extracts a valid ZIP and tar.gz", async () => {
    const zipRoot = await extractionRoot();
    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("export const ok = true;\n"));
    await extractZipSafely(zip, zipRoot);
    await expect(readFile(join(zipRoot, "src/index.ts"), "utf8")).resolves.toContain("ok = true");

    const tarRoot = await extractionRoot();
    const tarPath = await tarFrom([{ name: "src/index.ts", content: "package ok\n" }]);
    await extractTarGzSafely(tarPath, tarRoot);
    await expect(readFile(join(tarRoot, "src/index.ts"), "utf8")).resolves.toContain("package ok");
  });

  it.each(["../outside.txt", "..\\outside.txt", "nested/../outside.txt", "/tmp/outside.txt", "C:/outside.txt"])(
    "rejects traversal spelling %s",
    async (name) => {
      const root = await extractionRoot();
      expect(() => validateArchiveEntryPath(name, root)).toThrow(ArchiveSafetyError);
    },
  );

  it("rejects ZIP symlinks before they are created", async () => {
    const root = await extractionRoot();
    const zip = new AdmZip();
    // Unix symlink mode in external attributes; the payload is its link target.
    zip.addFile("escape", Buffer.from("../../etc/passwd"));
    const entry = zip.getEntries()[0];
    entry.header.made = 0x0300;
    entry.header.attr = (0o120777 << 16) >>> 0;
    await expect(extractZipSafely(zip, root)).rejects.toThrow(/link/i);
  });

  it("rejects tar symlinks and does not write outside the root", async () => {
    const source = await mkdtemp(join(tmpdir(), "eos-tar-link-"));
    roots.push(source);
    await symlink("/tmp/should-not-be-created", join(source, "escape"));
    const tarPath = join(source, "archive.tar.gz");
    await execFileAsync("tar", ["-czf", tarPath, "-C", source, "escape"]);
    const root = await extractionRoot();
    await expect(extractTarGzSafely(tarPath, root)).rejects.toThrow(/link|special/i);
  });

  it.each(["relative", "absolute"])(
    "rejects a %s TAR traversal member before extraction",
    async (kind) => {
      const root = await extractionRoot();
      const fileName = `eos-archive-escape-${randomUUID()}.ts`;
      const memberName = kind === "relative" ? `../${fileName}` : join(tmpdir(), fileName);
      const outsidePath = kind === "relative"
        ? join(root, "..", fileName)
        : join(tmpdir(), fileName);
      const tarPath = await tarWithTransformedMember(memberName);

      await expect(extractTarGzSafely(tarPath, root)).rejects.toThrow(/unsafe path/i);
      await expect(readFile(outsidePath)).rejects.toThrow();
    },
  );

  it("enforces TAR entry-count, per-entry, and total expanded-size limits", async () => {
    const root = await extractionRoot();
    const twoFiles = await tarFrom([
      { name: "first.ts", content: "123" },
      { name: "second.ts", content: "456" },
    ]);
    const smallLimits = {
      maxEntries: 1,
      maxEntryBytes: 3,
      maxExpandedBytes: 5,
    };

    await expect(extractTarGzSafely(twoFiles, root, smallLimits)).rejects.toThrow(/too many entries/i);
    await expect(readFile(join(root, "first.ts"))).rejects.toThrow();

    const entryRoot = await extractionRoot();
    const oneLargeFile = await tarFrom([{ name: "large.ts", content: "1234" }]);
    await expect(
      extractTarGzSafely(oneLargeFile, entryRoot, {
        maxEntries: 2,
        maxEntryBytes: 3,
        maxExpandedBytes: 10,
      }),
    ).rejects.toThrow(/too large/i);

    const totalRoot = await extractionRoot();
    await expect(
      extractTarGzSafely(twoFiles, totalRoot, {
        maxEntries: 2,
        maxEntryBytes: 3,
        maxExpandedBytes: 5,
      }),
    ).rejects.toThrow(/expanded|permitted/i);
    await expect(readFile(join(totalRoot, "first.ts"))).rejects.toThrow();
  });

  it("rejects an entry larger than the per-entry limit", async () => {
    const root = await extractionRoot();
    const zip = new AdmZip();
    zip.addFile("large.bin", Buffer.alloc(ARCHIVE_LIMITS.maxEntryBytes + 1));
    await expect(extractZipSafely(zip, root)).rejects.toThrow(/too large/i);
  });

  it("rejects too many entries before extracting", async () => {
    const root = await extractionRoot();
    const zip = new AdmZip();
    for (let i = 0; i <= ARCHIVE_LIMITS.maxEntries; i++) zip.addFile(`file-${i}`, Buffer.from("x"));
    await expect(extractZipSafely(zip, root)).rejects.toThrow(/too many entries/i);
    await expect(readFile(join(root, "file-0"))).rejects.toThrow();
  });

  it("rejects expansion beyond the total limit", async () => {
    const root = await extractionRoot();
    const zip = new AdmZip();
    for (let i = 0; i < 5; i++) zip.addFile(`chunk-${i}`, Buffer.alloc(ARCHIVE_LIMITS.maxEntryBytes));
    await expect(extractZipSafely(zip, root)).rejects.toThrow(/expanded|permitted/i);
  });
});