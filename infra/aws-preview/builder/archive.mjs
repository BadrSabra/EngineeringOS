import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { gzipSync, inflateRawSync } from "node:zlib";
import {
  BUILDER_PROFILE,
  MAX_INPUT_ARCHIVE_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_OUTPUT_ARCHIVE_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_FILE_BYTES,
  MAX_OUTPUT_FILES,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
} from "./profile.mjs";

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_LOCAL_FILE = 0x04034b50;
const TAR_BLOCK_BYTES = 512;
const MANIFEST_PATH = "engineeringos-preview-manifest.json";
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

export class PreviewBuilderError extends Error {
  constructor(code) {
    super("Preview build input or output is invalid or unavailable.");
    this.name = "PreviewBuilderError";
    this.code = code;
  }
}

function fail(code) {
  throw new PreviewBuilderError(code);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeArchivePath(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_024 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.includes(":") ||
          segment.toLowerCase() === "node_modules",
      )
  ) {
    fail("PREVIEW_BUILD_INPUT_UNSAFE");
  }
  return value;
}

function safeSourceRoot(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    (value !== "." &&
      (value.includes("\\") ||
        value.includes("\0") ||
        value.startsWith("/") ||
        value
          .split("/")
          .some(
            (segment) =>
              !segment ||
              segment === "." ||
              segment === ".." ||
              segment.includes(":"),
          )))
  ) {
    fail("PREVIEW_BUILD_INPUT_INVALID");
  }
  return value;
}

function zipName(bytes, flags) {
  if ((flags & ~0x0800) !== 0) fail("PREVIEW_BUILD_ARCHIVE_INVALID");
  if ((flags & 0x0800) !== 0) {
    try {
      return UTF8_DECODER.decode(bytes);
    } catch {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
  }
  if (bytes.some((byte) => byte > 0x7f)) {
    fail("PREVIEW_BUILD_ARCHIVE_INVALID");
  }
  return bytes.toString("ascii");
}

function rejectZip64(extra, offset, length) {
  const end = offset + length;
  let cursor = offset;
  for (; cursor + 4 <= end;) {
    const id = extra.readUInt16LE(cursor);
    const fieldLength = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + fieldLength > end || id === 0x0001) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
    cursor += fieldLength;
  }
  if (cursor !== end) fail("PREVIEW_BUILD_ARCHIVE_INVALID");
}

function parseZipRecords(archive) {
  if (
    !Buffer.isBuffer(archive) ||
    archive.length < 22 ||
    archive.length > MAX_INPUT_ARCHIVE_BYTES
  ) {
    fail("PREVIEW_BUILD_ARCHIVE_INVALID");
  }

  const minEocdOffset = Math.max(0, archive.length - 65_557);
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (
      archive.readUInt32LE(offset) === ZIP_EOCD &&
      offset + 22 + archive.readUInt16LE(offset + 20) === archive.length
    ) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) fail("PREVIEW_BUILD_ARCHIVE_INVALID");

  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectoryBytes = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentBytes = archive.readUInt16LE(eocdOffset + 20);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount < 1 ||
    entryCount > MAX_SOURCE_FILES + 1 ||
    centralDirectoryOffset + centralDirectoryBytes !== eocdOffset ||
    commentBytes !== 0
  ) {
    fail("PREVIEW_BUILD_ARCHIVE_INVALID");
  }

  const records = [];
  let cursor = centralDirectoryOffset;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (
      cursor + 46 > eocdOffset ||
      archive.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE
    ) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
    const versionMadeBy = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameBytes = archive.readUInt16LE(cursor + 28);
    const extraBytes = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const startDisk = archive.readUInt16LE(cursor + 34);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const recordEnd = cursor + 46 + nameBytes + extraBytes + commentLength;
    if (
      recordEnd > eocdOffset ||
      startDisk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      ![0, 8].includes(method)
    ) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }

    const name = zipName(
      archive.subarray(cursor + 46, cursor + 46 + nameBytes),
      flags,
    );
    safeArchivePath(name);
    const hostSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const unixType = unixMode & 0xf000;
    if (
      (hostSystem === 3 && unixType !== 0 && unixType !== 0x8000) ||
      compressedSize > MAX_INPUT_ARCHIVE_BYTES ||
      uncompressedSize > MAX_SOURCE_FILE_BYTES
    ) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }

    rejectZip64(archive, cursor + 46 + nameBytes, extraBytes);

    if (
      localOffset + 30 > centralDirectoryOffset ||
      archive.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE
    ) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(localOffset + 22);
    const localNameBytes = archive.readUInt16LE(localOffset + 26);
    const localExtraBytes = archive.readUInt16LE(localOffset + 28);
    const localNameEnd = localOffset + 30 + localNameBytes;
    const dataStart = localNameEnd + localExtraBytes;
    const dataEnd = dataStart + compressedSize;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localChecksum !== checksum ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      localNameEnd > centralDirectoryOffset ||
      dataStart > centralDirectoryOffset ||
      dataEnd > centralDirectoryOffset ||
      zipName(archive.subarray(localOffset + 30, localNameEnd), localFlags) !==
        name
    ) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
    rejectZip64(archive, localNameEnd, localExtraBytes);
    records.push({
      name,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      dataStart,
      dataEnd,
      localOffset,
    });
    cursor = recordEnd;
  }
  if (cursor !== eocdOffset) fail("PREVIEW_BUILD_ARCHIVE_INVALID");

  const orderedRanges = [...records].sort(
    (left, right) => left.localOffset - right.localOffset,
  );
  for (let index = 1; index < orderedRanges.length; index += 1) {
    if (orderedRanges[index - 1].dataEnd > orderedRanges[index].localOffset) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
  }

  const decoded = new Map();
  for (const record of records) {
    if (decoded.has(record.name)) fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    const compressed = archive.subarray(record.dataStart, record.dataEnd);
    let bytes;
    try {
      bytes =
        record.method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, record.uncompressedSize),
            });
    } catch {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
    if (
      bytes.length !== record.uncompressedSize ||
      crc32(bytes) !== record.checksum
    ) {
      fail("PREVIEW_BUILD_ARCHIVE_INVALID");
    }
    decoded.set(record.name, bytes);
  }
  return decoded;
}

function validIdentityString(value, limit = 255) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    value.trim() === value
  );
}

function verifyManifest(manifest, files, expectedBinding) {
  const allowedKeys = [
    "version",
    "builderProfile",
    "projectId",
    "proposalId",
    "operationId",
    "proposalRevision",
    "candidateRevision",
    "changeSetHash",
    "sourceRoot",
    "sourceDigest",
    "files",
  ];
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    Object.keys(manifest).length !== allowedKeys.length ||
    allowedKeys.some((key) => !(key in manifest)) ||
    manifest.version !== 1 ||
    manifest.builderProfile !== BUILDER_PROFILE ||
    !validIdentityString(manifest.projectId) ||
    !validIdentityString(manifest.proposalId) ||
    !validIdentityString(manifest.operationId) ||
    !Number.isSafeInteger(manifest.proposalRevision) ||
    manifest.proposalRevision < 0 ||
    !HASH_PATTERN.test(manifest.candidateRevision ?? "") ||
    !HASH_PATTERN.test(manifest.changeSetHash ?? "") ||
    !safeSourceRoot(manifest.sourceRoot) ||
    !HASH_PATTERN.test(manifest.sourceDigest ?? "") ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > MAX_SOURCE_FILES ||
    !expectedBinding ||
    typeof expectedBinding !== "object" ||
    Array.isArray(expectedBinding)
  ) {
    fail("PREVIEW_BUILD_MANIFEST_INVALID");
  }

  const expectedKeys = [
    "builderProfile",
    "projectId",
    "proposalId",
    "operationId",
    "proposalRevision",
    "candidateRevision",
    "changeSetHash",
    "sourceRoot",
    "sourceDigest",
  ];
  if (
    Object.keys(expectedBinding).length !== expectedKeys.length ||
    expectedKeys.some(
      (key) =>
        !(key in expectedBinding) || expectedBinding[key] !== manifest[key],
    )
  ) {
    fail("PREVIEW_BUILD_BINDING_MISMATCH");
  }

  let totalBytes = 0;
  let previousPath = "";
  const verifiedFiles = new Map();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      Object.keys(file).length !== 3 ||
      !("path" in file) ||
      !("size" in file) ||
      !("sha256" in file) ||
      typeof file.path !== "string" ||
      safeArchivePath(file.path) !== file.path ||
      file.path <= previousPath ||
      file.path === MANIFEST_PATH ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_SOURCE_FILE_BYTES ||
      !HASH_PATTERN.test(file.sha256)
    ) {
      fail("PREVIEW_BUILD_MANIFEST_INVALID");
    }
    previousPath = file.path;
    const bytes = files.get(file.path);
    if (!bytes || bytes.length !== file.size || hash(bytes) !== file.sha256) {
      fail("PREVIEW_BUILD_SOURCE_DIGEST_MISMATCH");
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_SOURCE_BYTES) {
      fail("PREVIEW_BUILD_INPUT_LIMIT");
    }
    verifiedFiles.set(file.path, bytes);
  }

  if (
    verifiedFiles.size !== files.size - 1 ||
    hash(
      Buffer.from(
        JSON.stringify({
          sourceRoot: manifest.sourceRoot,
          files: manifest.files,
        }),
        "utf8",
      ),
    ) !== manifest.sourceDigest
  ) {
    fail("PREVIEW_BUILD_SOURCE_DIGEST_MISMATCH");
  }

  const indexPath =
    manifest.sourceRoot === "."
      ? "index.html"
      : `${manifest.sourceRoot}/index.html`;
  if (!verifiedFiles.has(indexPath)) fail("PREVIEW_BUILD_SOURCE_ROOT_INVALID");
  return { manifest, files: verifiedFiles };
}

export function parsePreviewBuildInputArchive(archive, expectedBinding) {
  const archiveFiles = parseZipRecords(archive);
  const manifestBytes = archiveFiles.get(MANIFEST_PATH);
  if (!manifestBytes || manifestBytes.length > MAX_MANIFEST_BYTES) {
    fail("PREVIEW_BUILD_MANIFEST_INVALID");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("PREVIEW_BUILD_MANIFEST_INVALID");
  }
  return verifyManifest(manifest, archiveFiles, expectedBinding);
}

function writeOctal(header, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("PREVIEW_BUILD_OUTPUT_INVALID");
  }
  const digits = value.toString(8);
  if (digits.length > length - 1) fail("PREVIEW_BUILD_OUTPUT_LIMIT");
  header.write(digits.padStart(length - 1, "0"), offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function writeText(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) fail("PREVIEW_BUILD_OUTPUT_INVALID");
  bytes.copy(header, offset);
}

function splitTarPath(filePath) {
  const whole = Buffer.from(filePath, "utf8");
  if (whole.length <= 100) return { name: filePath, prefix: "" };
  const slashPositions = [];
  for (let index = 0; index < filePath.length; index += 1) {
    if (filePath[index] === "/") slashPositions.push(index);
  }
  for (const slash of slashPositions.toReversed()) {
    const prefix = filePath.slice(0, slash);
    const name = filePath.slice(slash + 1);
    if (
      Buffer.byteLength(prefix, "utf8") <= 155 &&
      Buffer.byteLength(name, "utf8") <= 100
    ) {
      return { name, prefix };
    }
  }
  fail("PREVIEW_BUILD_OUTPUT_INVALID");
}

function createTarHeader(filePath, size) {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  const { name, prefix } = splitTarPath(filePath);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, 257, 6, "ustar\0");
  writeText(header, 263, 2, "00");
  writeText(header, 265, 32, "root");
  writeText(header, 297, 32, "root");
  writeText(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

async function collectStaticFiles(root) {
  const files = [];
  let totalBytes = 0;

  async function visit(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      safeArchivePath(relativePath);
      const absolutePath = path.join(directory, entry.name);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) fail("PREVIEW_BUILD_OUTPUT_INVALID");
      if (stats.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!stats.isFile()) fail("PREVIEW_BUILD_OUTPUT_INVALID");
      if (
        files.length >= MAX_OUTPUT_FILES ||
        stats.size > MAX_OUTPUT_FILE_BYTES
      ) {
        fail("PREVIEW_BUILD_OUTPUT_LIMIT");
      }
      totalBytes += stats.size;
      if (totalBytes > MAX_OUTPUT_BYTES) fail("PREVIEW_BUILD_OUTPUT_LIMIT");

      const handle = await open(
        absolutePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      try {
        const current = await handle.stat();
        if (
          !current.isFile() ||
          current.dev !== stats.dev ||
          current.ino !== stats.ino ||
          current.size !== stats.size
        ) {
          fail("PREVIEW_BUILD_OUTPUT_INVALID");
        }
        const bytes = await handle.readFile();
        if (bytes.length !== stats.size) fail("PREVIEW_BUILD_OUTPUT_INVALID");
        files.push({ path: relativePath, bytes });
      } finally {
        await handle.close();
      }
    }
  }

  await visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (!files.some((file) => file.path === "index.html")) {
    fail("PREVIEW_BUILD_OUTPUT_INVALID");
  }
  return files;
}

export async function createPreviewStaticArchive(outputRoot) {
  const files = await collectStaticFiles(outputRoot);
  const chunks = [];
  for (const file of files) {
    chunks.push(createTarHeader(file.path, file.bytes.length));
    chunks.push(file.bytes);
    const padding =
      (TAR_BLOCK_BYTES - (file.bytes.length % TAR_BLOCK_BYTES)) %
      TAR_BLOCK_BYTES;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2));
  const compressed = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
  if (compressed.length > MAX_OUTPUT_ARCHIVE_BYTES) {
    fail("PREVIEW_BUILD_OUTPUT_LIMIT");
  }
  return compressed;
}

export async function extractPreviewBuildFiles(files, workspaceRoot) {
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  for (const [relativePath, bytes] of files) {
    safeArchivePath(relativePath);
    const absolutePath = path.resolve(
      workspaceRoot,
      ...relativePath.split("/"),
    );
    const relative = path.relative(workspaceRoot, absolutePath);
    if (
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    ) {
      fail("PREVIEW_BUILD_INPUT_UNSAFE");
    }
    await mkdir(path.dirname(absolutePath), {
      recursive: true,
      mode: 0o700,
    });
    const handle = await open(absolutePath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  }
}

export async function removePreviewBuildDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
}
