import { describe, expect, it, afterEach } from "vitest";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
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

describe("archive extraction safety policy", () => {
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