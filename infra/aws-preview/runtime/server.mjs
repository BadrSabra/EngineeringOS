import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FILE_COUNT = 5_000;
const TAR_BLOCK_BYTES = 512;

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export class PreviewStaticRuntimeError extends Error {
  constructor(code) {
    super("Preview static bundle is invalid or unavailable.");
    this.name = "PreviewStaticRuntimeError";
    this.code = code;
  }
}

function readText(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  const value = field.subarray(0, end < 0 ? field.length : end);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
}

function readOctal(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  if (field[0] & 0x80) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  const text = field.toString("ascii").replace(/\0.*$/u, "").trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/u.test(text)) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  return value;
}

function validateHeaderChecksum(header) {
  const expected = readOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
}

function validatePath(value, directory) {
  const normalized = directory ? value.replace(/\/+$/u, "") : value;
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  return normalized;
}

function parseTarArchive(tarBytes) {
  if (
    tarBytes.length < TAR_BLOCK_BYTES * 2 ||
    tarBytes.length % TAR_BLOCK_BYTES !== 0
  ) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }

  const files = new Map();
  let totalFileBytes = 0;
  let entryCount = 0;
  let offset = 0;
  let sawEnd = false;

  while (offset + TAR_BLOCK_BYTES <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) {
      sawEnd = true;
      if (tarBytes.subarray(offset).some((byte) => byte !== 0)) {
        throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
      }
      break;
    }
    validateHeaderChecksum(header);
    if (
      header.toString("ascii", 257, 263) !== "ustar\0" ||
      header.toString("ascii", 263, 265) !== "00"
    ) {
      throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
    }

    const name = readText(header, 0, 100);
    const prefix = readText(header, 345, 155);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const size = readOctal(header, 124, 12);
    const isDirectory = type === "5";
    entryCount += 1;
    if (
      entryCount > MAX_FILE_COUNT ||
      (type !== "0" && !isDirectory) ||
      (isDirectory && size !== 0) ||
      size > MAX_FILE_BYTES
    ) {
      throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
    }

    const path = validatePath(rawPath, isDirectory);
    const contentStart = offset + TAR_BLOCK_BYTES;
    const contentEnd = contentStart + size;
    const nextBlock =
      contentStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    if (contentEnd > tarBytes.length || nextBlock > tarBytes.length) {
      throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
    }
    if (!isDirectory) {
      if (files.has(path) || files.size >= MAX_FILE_COUNT) {
        throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
      }
      totalFileBytes += size;
      if (totalFileBytes > MAX_EXPANDED_BYTES) {
        throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_LIMIT");
      }
      files.set(path, Buffer.from(tarBytes.subarray(contentStart, contentEnd)));
    }
    offset = nextBlock;
  }

  if (!sawEnd || !files.has("index.html")) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  return files;
}

export function parsePreviewStaticArchive(archiveBytes, expectedSha256) {
  if (
    !Buffer.isBuffer(archiveBytes) ||
    archiveBytes.length === 0 ||
    archiveBytes.length > MAX_ARCHIVE_BYTES ||
    !/^[a-f0-9]{64}$/iu.test(expectedSha256 ?? "")
  ) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  const actualSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_DIGEST_MISMATCH");
  }
  let tarBytes;
  try {
    tarBytes = gunzipSync(archiveBytes, {
      maxOutputLength: MAX_EXPANDED_BYTES + MAX_FILE_COUNT * TAR_BLOCK_BYTES,
    });
  } catch {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  return parseTarArchive(tarBytes);
}

function validateOutputLocation(urlValue, objectKey) {
  try {
    const url = new URL(urlValue);
    const expectedKey =
      /^preview-build-outputs\/[0-9a-f-]{36}\/site\.tar\.gz$/iu;
    const s3Host =
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\.s3\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/iu;
    const signedLifetime = Number(url.searchParams.get("X-Amz-Expires"));
    if (
      url.protocol !== "https:" ||
      !s3Host.test(url.hostname) ||
      url.username ||
      url.password ||
      url.hash ||
      !expectedKey.test(objectKey ?? "") ||
      decodeURIComponent(url.pathname.slice(1)) !== objectKey ||
      url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
      !/^[a-f0-9]{64}$/iu.test(url.searchParams.get("X-Amz-Signature") ?? "") ||
      !Number.isInteger(signedLifetime) ||
      signedLifetime < 1 ||
      signedLifetime > 300
    ) {
      throw new Error("Invalid artifact location.");
    }
    return url;
  } catch {
    throw new PreviewStaticRuntimeError("PREVIEW_OUTPUT_LOCATION_INVALID");
  }
}

export async function downloadPreviewStaticArchive({
  url: urlValue,
  objectKey,
  expectedSha256,
  fetcher = fetch,
}) {
  const url = validateOutputLocation(urlValue, objectKey);
  if (!/^[a-f0-9]{64}$/iu.test(expectedSha256 ?? "")) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  let response;
  try {
    response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PreviewStaticRuntimeError("PREVIEW_OUTPUT_UNAVAILABLE");
  }
  if (!response.ok || !response.body) {
    throw new PreviewStaticRuntimeError("PREVIEW_OUTPUT_UNAVAILABLE");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_LIMIT");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_LIMIT");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return parsePreviewStaticArchive(
    Buffer.concat(chunks, total),
    expectedSha256,
  );
}

export function safePreviewRequestPath(requestUrl) {
  if (
    typeof requestUrl !== "string" ||
    !requestUrl.startsWith("/") ||
    requestUrl.startsWith("//")
  ) {
    return null;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.split("?", 1)[0]);
  } catch {
    return null;
  }
  if (pathname.includes("\\") || pathname.includes("\0")) return null;
  const path = pathname.replace(/^\/+|\/+$/gu, "");
  if (!path) return "index.html";
  const segments = path.split("/");
  if (
    segments.some((segment) => segment === "." || segment === ".." || !segment)
  ) {
    return null;
  }
  return path;
}

export function createPreviewStaticServer(files) {
  if (!(files instanceof Map) || !files.has("index.html")) {
    throw new PreviewStaticRuntimeError("PREVIEW_ARCHIVE_INVALID");
  }
  return createServer((request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("cache-control", "no-store");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );

    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }

    const requestedPath = safePreviewRequestPath(request.url);
    if (!requestedPath) {
      response.writeHead(400);
      response.end();
      return;
    }
    let filePath = requestedPath;
    if (!files.has(filePath) && !filePath.split("/").at(-1)?.includes(".")) {
      filePath = "index.html";
    }
    const content = files.get(filePath);
    if (!content) {
      response.writeHead(404);
      response.end();
      return;
    }

    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES.get(extension) ?? "application/octet-stream",
      "content-length": content.length,
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

export async function startPreviewStaticRuntime(env = process.env) {
  const objectKey = env.PREVIEW_BUILD_OUTPUT_KEY;
  const expectedSha256 = env.PREVIEW_BUILD_OUTPUT_SHA256;
  const files = await downloadPreviewStaticArchive({
    url: env.PREVIEW_BUILD_OUTPUT_URL,
    objectKey,
    expectedSha256,
  });
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PreviewStaticRuntimeError("PREVIEW_RUNTIME_CONFIG_INVALID");
  }
  const server = createPreviewStaticServer(files);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  return server;
}

if (process.argv[1]?.endsWith("/server.mjs")) {
  startPreviewStaticRuntime().catch(() => {
    console.error("Preview static runtime failed to load its bound artifact.");
    process.exitCode = 1;
  });
}
