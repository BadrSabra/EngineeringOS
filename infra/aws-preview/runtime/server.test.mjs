import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { after, describe, it } from "node:test";
import {
  createPreviewStaticServer,
  downloadPreviewStaticArchive,
  parsePreviewStaticArchive,
  PreviewStaticRuntimeError,
  safePreviewRequestPath,
} from "./server.mjs";

function writeOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  header.write(`${text}\0`, offset, length, "ascii");
}

function tarHeader(path, content, type = "0") {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 1_700_000_000);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, 148, 8, checksum);
  return header;
}

function makeArchive(entries) {
  const chunks = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "");
    chunks.push(tarHeader(entry.path, content, entry.type ?? "0"));
    chunks.push(content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

const archive = makeArchive([
  { path: "index.html", content: "<main>preview</main>" },
  { path: "assets/app.js", content: "console.log('preview')" },
]);
const sha256 = createHash("sha256").update(archive).digest("hex");
const objectKey =
  "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz";
const downloadUrl =
  "https://engineeringos-preview-artifacts.s3.eu-central-1.amazonaws.com/preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=" +
  "a".repeat(64);

describe("Preview static runtime", () => {
  let server;
  let origin;

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("validates the output hash and accepts only regular POSIX ustar files", () => {
    const files = parsePreviewStaticArchive(archive, sha256);
    assert.equal(files.get("index.html")?.toString(), "<main>preview</main>");
    assert.equal(
      files.get("assets/app.js")?.toString(),
      "console.log('preview')",
    );
    assert.throws(
      () => parsePreviewStaticArchive(archive, "0".repeat(64)),
      (error) =>
        error instanceof PreviewStaticRuntimeError &&
        error.code === "PREVIEW_ARCHIVE_DIGEST_MISMATCH",
    );
    assert.throws(() =>
      parsePreviewStaticArchive(
        makeArchive([
          { path: "index.html", content: "x" },
          { path: "../escape.txt", content: "x" },
        ]),
        createHash("sha256")
          .update(
            makeArchive([
              { path: "index.html", content: "x" },
              { path: "../escape.txt", content: "x" },
            ]),
          )
          .digest("hex"),
      ),
    );
    assert.throws(() =>
      parsePreviewStaticArchive(
        makeArchive([
          { path: "index.html", content: "x" },
          { path: "link", content: "", type: "2" },
        ]),
        createHash("sha256")
          .update(
            makeArchive([
              { path: "index.html", content: "x" },
              { path: "link", content: "", type: "2" },
            ]),
          )
          .digest("hex"),
      ),
    );
  });

  it("rejects non-S3 URLs and never follows redirects", async () => {
    await assert.rejects(
      downloadPreviewStaticArchive({
        url: "http://169.254.169.254/latest/meta-data",
        objectKey,
        expectedSha256: sha256,
      }),
      (error) =>
        error instanceof PreviewStaticRuntimeError &&
        error.code === "PREVIEW_OUTPUT_LOCATION_INVALID",
    );
    await assert.rejects(
      downloadPreviewStaticArchive({
        url: downloadUrl,
        objectKey,
        expectedSha256: sha256,
        fetcher: async (_url, options) => {
          assert.equal(options.redirect, "error");
          return Response.redirect("https://example.com/redirected", 302);
        },
      }),
      (error) =>
        error instanceof PreviewStaticRuntimeError &&
        error.code === "PREVIEW_OUTPUT_UNAVAILABLE",
    );
  });

  it("rejects traversal after decoding the raw request target", () => {
    assert.equal(safePreviewRequestPath("/%2e%2e/private"), null);
    assert.equal(safePreviewRequestPath("/assets/%2e%2e/index.html"), null);
    assert.equal(safePreviewRequestPath("/assets/app.js"), "assets/app.js");
  });

  it("serves only the verified in-memory site with safe methods and headers", async () => {
    const files = parsePreviewStaticArchive(archive, sha256);
    server = createPreviewStaticServer(files);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;

    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.equal(await home.text(), "<main>preview</main>");
    assert.equal(
      home.headers
        .get("content-security-policy")
        ?.includes("connect-src 'self'"),
      true,
    );
    assert.equal(home.headers.get("set-cookie"), null);

    const script = await fetch(`${origin}/assets/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /javascript/u);
    assert.equal(await script.text(), "console.log('preview')");

    assert.equal(
      (await fetch(`${origin}/route/without-extension`)).status,
      200,
    );
    assert.equal((await fetch(`${origin}/assets/missing.js`)).status, 404);
    assert.equal(
      (await fetch(origin, { method: "POST" })).headers.get("allow"),
      "GET, HEAD",
    );
  });
});
