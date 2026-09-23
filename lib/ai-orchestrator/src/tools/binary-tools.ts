import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { isSensitiveProjectPath, type ToolDefinition } from "./file-tools.js";

const MAX_HASH_BYTES = 32 * 1024 * 1024;
const MAX_HEADER_BYTES = 1_048_576;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class PngInspectionError extends Error {
  constructor(readonly code: "PNG_INVALID_STRUCTURE" | "PNG_TRUNCATED") {
    super("PNG structure could not be validated.");
    this.name = "PngInspectionError";
  }
}

export const BINARY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_binary",
      description:
        "Inspect a project image, PDF, or other non-text file without returning raw bytes. " +
        "Returns bounded type, size, hash, and format metadata tied to the current operation revision.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path to the binary file." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
];

export const BINARY_TOOL_NAMES = new Set(BINARY_TOOL_DEFINITIONS.map((tool) => tool.function.name));

type BinaryToolContext = {
  operationId?: string;
  revision?: string;
};

async function readHeader(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath: string, sizeBytes: number, header: Buffer): Promise<{
  digest: string;
  complete: boolean;
}> {
  const hash = createHash("sha256");
  if (sizeBytes > MAX_HASH_BYTES) {
    hash.update(header);
    return { digest: hash.digest("hex"), complete: false };
  }
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return { digest: hash.digest("hex"), complete: true };
}

function detectFormat(buffer: Buffer, fileName: string): Record<string, unknown> {
  const extension = path.extname(fileName).toLowerCase();
  const hasPngSignaturePrefix = buffer.length > 0
    && PNG_SIGNATURE.subarray(0, buffer.length).equals(buffer.subarray(0, Math.min(buffer.length, PNG_SIGNATURE.length)));
  if (extension === ".png" || hasPngSignaturePrefix || buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (buffer.length < PNG_SIGNATURE.length) throw new PngInspectionError("PNG_TRUNCATED");
    if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new PngInspectionError("PNG_INVALID_STRUCTURE");
    }
    if (buffer.length < 16) throw new PngInspectionError("PNG_TRUNCATED");
    const ihdrLength = buffer.readUInt32BE(8);
    if (ihdrLength !== 13 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
      throw new PngInspectionError("PNG_INVALID_STRUCTURE");
    }
    if (buffer.length < 16 + ihdrLength) throw new PngInspectionError("PNG_TRUNCATED");
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width <= 0 || height <= 0) throw new PngInspectionError("PNG_INVALID_STRUCTURE");
    return {
      mediaType: "image/png",
      width,
      height,
    };
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    for (let offset = 2; offset + 9 < buffer.length;) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2 || offset + segmentLength + 2 > buffer.length) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          mediaType: "image/jpeg",
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += segmentLength + 2;
    }
    return { mediaType: "image/jpeg" };
  }
  if (buffer.subarray(0, 6).toString("ascii") === "GIF89a" || buffer.subarray(0, 6).toString("ascii") === "GIF87a") {
    return {
      mediaType: "image/gif",
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mediaType: "image/webp" };
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    const pageMatches = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g);
    return {
      mediaType: "application/pdf",
      pageCountHint: pageMatches?.length ?? 0,
    };
  }
  return {
    mediaType: extension === ".zip" ? "application/zip" : "application/octet-stream",
  };
}

function normalizeProjectPath(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/")).replace(/^(\.\/)+/, "");
}

function binaryEvidenceIdentity(params: {
  operationId: string;
  workspaceRevision: string;
  normalizedPath: string;
  digest: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex");
}

export async function executeBinaryTool(
  name: string,
  args: Record<string, string>,
  rootPath: string,
  context?: BinaryToolContext,
): Promise<string> {
  if (!BINARY_TOOL_NAMES.has(name)) {
    return JSON.stringify({ tool: name, status: "failed", code: "UNKNOWN_BINARY_TOOL" });
  }
  if (!context?.operationId || !context.revision) {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "BINARY_REVISION_CONTEXT_REQUIRED",
      detail: "Binary inspection requires a server-owned operation and workspace revision.",
    });
  }
  const requestedPath = args.path?.trim();
  if (!requestedPath || requestedPath.includes("\0") || isSensitiveProjectPath(requestedPath)) {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "BINARY_PATH_NOT_ALLOWED",
      detail: "Binary inspection requires a non-sensitive project-relative file path.",
      operationId: context.operationId,
      workspaceRevision: context.revision,
    });
  }
  const normalizedPath = normalizeProjectPath(requestedPath);
  try {
    const root = await fs.realpath(path.resolve(rootPath));
    const candidate = path.resolve(root, requestedPath);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      throw new Error("outside-root");
    }
    const realPath = await fs.realpath(candidate);
    if (realPath !== root && !realPath.startsWith(`${root}${path.sep}`)) {
      throw new Error("outside-root");
    }
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw new Error("not-file");
    const headerBytes = await readHeader(realPath);
    const metadata = detectFormat(headerBytes, requestedPath);
    const hash = await hashFile(realPath, stat.size, headerBytes);
    const isPng = metadata.mediaType === "image/png";
    if (isPng && !hash.complete) {
      return JSON.stringify({
        tool: name,
        status: "incomplete",
        code: "PNG_HASH_INCOMPLETE",
        detail: "PNG inspection requires a complete sha256 over the approved file.",
        path: normalizedPath,
        operationId: context.operationId,
        workspaceRevision: context.revision,
        sizeBytes: stat.size,
        sha256: hash.digest,
        hashComplete: false,
        ...metadata,
      });
    }
    const evidenceIdentity = isPng
      ? binaryEvidenceIdentity({
          operationId: context.operationId,
          workspaceRevision: context.revision,
          normalizedPath,
          digest: hash.digest,
        })
      : undefined;
    return JSON.stringify({
      tool: name,
      status: "complete",
      path: normalizedPath,
      operationId: context.operationId,
      workspaceRevision: context.revision,
      sizeBytes: stat.size,
      sha256: hash.digest,
      hashComplete: hash.complete,
      ...(evidenceIdentity
        ? {
            evidenceId: `binary-evidence:${evidenceIdentity}`,
            artifactRef: `binary-artifact:${evidenceIdentity}`,
          }
        : {}),
      ...metadata,
    });
  } catch (error) {
    if (error instanceof PngInspectionError) {
      return JSON.stringify({
        tool: name,
        status: "incomplete",
        code: error.code,
        detail: "The PNG signature and IHDR structure could not be validated safely.",
        path: normalizedPath,
        operationId: context.operationId,
        workspaceRevision: context.revision,
      });
    }
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "BINARY_FILE_UNAVAILABLE",
      detail: "The approved binary path was unavailable or could not be inspected safely.",
      operationId: context.operationId,
      workspaceRevision: context.revision,
    });
  }
}