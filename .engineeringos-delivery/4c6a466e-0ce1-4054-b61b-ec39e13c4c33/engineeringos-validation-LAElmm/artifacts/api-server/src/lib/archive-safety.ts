import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, posix } from "node:path";
import AdmZip from "adm-zip";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** These limits apply to the expanded archive, not the compressed upload. */
export const ARCHIVE_LIMITS = {
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 256 * 1024 * 1024,
} as const;

export class ArchiveSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveSafetyError";
  }
}

export function validateArchiveEntryPath(entryName: string, root: string): string {
  const slashName = entryName.replace(/\\/g, "/");
  if (!slashName || slashName.includes("\0") || /^[A-Za-z]:\//.test(slashName) || slashName.startsWith("/") ||
      slashName.split("/").includes("..")) {
    throw new ArchiveSafetyError("archive contains an unsafe path");
  }
  const normalized = posix.normalize(slashName);
  if (normalized === "." || normalized.split("/").includes("..")) {
    throw new ArchiveSafetyError("archive contains an unsafe path");
  }
  const destination = resolve(root, ...normalized.split("/"));
  const rel = relative(root, destination);
  if (rel === ".." || rel.startsWith(`..${posix.sep}`) || rel.startsWith("/") || !destination.startsWith(`${resolve(root)}${posix.sep}`)) {
    throw new ArchiveSafetyError("archive contains an unsafe path");
  }
  return destination;
}

function checkLimits(entryCount: number, expandedBytes: number, entryBytes: number): number {
  if (entryCount > ARCHIVE_LIMITS.maxEntries) throw new ArchiveSafetyError("archive contains too many entries");
  if (!Number.isSafeInteger(entryBytes) || entryBytes < 0 || entryBytes > ARCHIVE_LIMITS.maxEntryBytes) {
    throw new ArchiveSafetyError("archive entry is too large");
  }
  const total = expandedBytes + entryBytes;
  if (!Number.isSafeInteger(total) || total > ARCHIVE_LIMITS.maxExpandedBytes) {
    throw new ArchiveSafetyError("archive expands beyond the permitted size");
  }
  return total;
}

function isZipLink(entry: AdmZip.IZipEntry): boolean {
  // Unix file type is stored in the high word of the external attributes.
  const mode = (entry.attr >>> 16) & 0xffff;
  const type = mode & 0o170000;
  // 0x400 is the Windows reparse-point bit (the equivalent of a link or
  // junction), which must not be materialized into the scanner root either.
  return (type !== 0 && type !== 0o100000 && type !== 0o040000) || (entry.attr & 0x400) !== 0;
}

export async function extractZipSafely(zip: AdmZip, root: string): Promise<void> {
  const entries = zip.getEntries();
  let expanded = 0;
  let count = 0;
  // Perform a complete metadata pass first. No bytes are decompressed until
  // the whole archive is known to fit the policy.
  for (const entry of entries) {
    count += 1;
    const entryName = entry.rawEntryName.toString("utf8");
    validateArchiveEntryPath(entryName, root);
    if (isZipLink(entry)) throw new ArchiveSafetyError("archive contains a link entry");
    const directory = entry.isDirectory || entry.entryName.endsWith("/") || entry.entryName.endsWith("\\");
    const size = directory ? 0 : entry.header.size;
    expanded = checkLimits(count, expanded, size);
  }

  count = 0;
  expanded = 0;
  for (const entry of entries) {
    count += 1;
    const destination = validateArchiveEntryPath(entry.rawEntryName.toString("utf8"), root);
    const directory = entry.isDirectory || entry.entryName.endsWith("/") || entry.entryName.endsWith("\\");
    const size = directory ? 0 : entry.header.size;
    expanded = checkLimits(count, expanded, size);
    if (directory) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    const data = entry.getData();
    // Check the actual decoded size too; this also protects against dishonest
    // metadata and ensures the accounting matches what reaches the filesystem.
    if (data.length !== size) expanded -= size;
    expanded = checkLimits(count, expanded, data.length);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, data, { flag: "wx" });
  }
}

type TarEntry = { name: string; type: string; size: number };

function parseTarListing(listing: string): TarEntry[] {
  return listing.split("\n").filter(Boolean).map((line) => {
    const type = line[0] ?? "";
    const match = line.match(/^\S+\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(.+)$/);
    if (!match) throw new ArchiveSafetyError("archive metadata is malformed");
    return { type, size: Number(match[1]), name: match[2] };
  });
}

export async function extractTarGzSafely(tarPath: string, root: string): Promise<void> {
  const { stdout } = await execFileAsync(
    "tar",
    ["-tvzf", tarPath, "--full-time", "--numeric-owner"],
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const entries = parseTarListing(stdout);
  let expanded = 0;
  let count = 0;
  for (const entry of entries) {
    count += 1;
    validateArchiveEntryPath(entry.name, root);
    if (entry.type !== "-" && entry.type !== "d") {
      throw new ArchiveSafetyError("archive contains a link or special entry");
    }
    expanded = checkLimits(count, expanded, entry.type === "d" ? 0 : entry.size);
  }
  await execFileAsync(
    "tar",
    ["-xzf", tarPath, "-C", root, "--no-same-owner", "--no-same-permissions", "--keep-directory-symlink"],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  );
}