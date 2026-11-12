import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import AdmZip from "adm-zip";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLocalPreviewBuildInputObjectStore } from "./preview-build-input-local.js";
import {
  createPreviewBuildInputUploadHandler,
  previewBuildInputObjectKey,
  signPreviewBuildInputUpload,
  verifyPreviewBuildInputUpload,
  type PreviewBuildInputUploadClaims,
  type PreviewBuildInputObjectStore,
} from "./preview-build-upload.js";
import type { PreviewBuildInputArchive } from "./preview-build-input.js";
import { PREVIEW_BUILD_INPUT_MANIFEST_PATH } from "./preview-build-input.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";

const now = new Date("2026-11-11T12:00:00.000Z");
const jobId = "00000000-0000-8000-8000-000000000001";
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

function buildInput(): PreviewBuildInputArchive {
  const sourceRoot = ".";
  const indexBytes = Buffer.from("<div id=\"root\"></div>");
  const files: PreviewBuildInputArchive["manifest"]["files"] = [
    {
      path: "index.html",
      size: indexBytes.length,
      sha256: createHash("sha256").update(indexBytes).digest("hex"),
    },
  ];
  const manifest = {
    version: 1 as const,
    builderProfile: "vite-react-static-v1" as const,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 3,
    candidateRevision: "a".repeat(64),
    changeSetHash: "b".repeat(64),
    sourceRoot,
    sourceDigest: createHash("sha256")
      .update(JSON.stringify({ sourceRoot, files }))
      .digest("hex"),
    files,
  };
  const zip = new AdmZip();
  zip.addFile("index.html", indexBytes);
  zip.addFile(
    PREVIEW_BUILD_INPUT_MANIFEST_PATH,
    Buffer.from(JSON.stringify(manifest), "utf8"),
  );
  const archive = zip.toBuffer();
  return {
    archive,
    archiveDigest: createHash("sha256").update(archive).digest("hex"),
    totalBytes: archive.byteLength,
    manifest,
  };
}

function signedToken(input = buildInput()): string {
  return signPreviewBuildInputUpload({
    buildInput: input,
    jobId,
    privateKeyPem,
    now,
  });
}

describe("signed Preview build-input upload", () => {
  it("binds the archive digest and exact Candidate identity to an Ed25519 token", () => {
    const source = buildInput();
    const token = signedToken(source);
    const claims = verifyPreviewBuildInputUpload(token, publicKeyPem, now);

    expect(claims).toMatchObject({
      action: "upload-build-input",
      version: 2,
      jobId,
      artifactRefId: previewBuildArtifactRefId(jobId, "input"),
      builderProfile: "vite-react-static-v1",
      projectId: "project-1",
      proposalId: "proposal-1",
      operationId: "operation-1",
      proposalRevision: 3,
      candidateRevision: "a".repeat(64),
      changeSetHash: "b".repeat(64),
      sourceDigest: source.manifest.sourceDigest,
      archiveDigest: source.archiveDigest,
      archiveBytes: source.archive.byteLength,
      expiresAt: "2026-11-11T12:00:30.000Z",
    });
    expect(previewBuildInputObjectKey(claims)).toMatch(
      /^build-inputs\/[a-f0-9]{64}\/[a-f0-9]{64}\.zip$/,
    );
    expect(previewBuildInputObjectKey(claims)).not.toContain("project-1");
  });

  it("rejects tampering, malformed signatures, and expired tokens", () => {
    const token = signedToken();
    const [payload, signature] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as PreviewBuildInputUploadClaims;
    decoded.archiveDigest = "d".repeat(64);
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    expect(() =>
      verifyPreviewBuildInputUpload(tampered, publicKeyPem, now),
    ).toThrow("Preview build input upload is invalid or unavailable.");
    expect(() =>
      verifyPreviewBuildInputUpload(
        token,
        publicKeyPem,
        new Date(now.getTime() + 31_000),
      ),
    ).toThrow("Preview build input upload is invalid or unavailable.");
  });

  it("keeps the job artifact reference stable across fresh upload tokens", () => {
    const source = buildInput();
    const first = verifyPreviewBuildInputUpload(
      signedToken(source),
      publicKeyPem,
      now,
    );
    const retry = verifyPreviewBuildInputUpload(
      signedToken(source),
      publicKeyPem,
      now,
    );
    const nextJob = verifyPreviewBuildInputUpload(
      signPreviewBuildInputUpload({
        buildInput: source,
        jobId: "00000000-0000-8000-8000-000000000002",
        privateKeyPem,
        now,
      }),
      publicKeyPem,
      now,
    );

    expect(retry.commandId).not.toBe(first.commandId);
    expect(retry.artifactRefId).toBe(first.artifactRefId);
    expect(nextJob.artifactRefId).not.toBe(first.artifactRefId);
  });

  it("refuses to sign a manifest that differs from the embedded archive", () => {
    const source = buildInput();
    const altered = {
      ...source,
      manifest: {
        ...source.manifest,
        projectId: "other-project",
      },
    };
    expect(() =>
      signPreviewBuildInputUpload({
        buildInput: altered,
        jobId,
        privateKeyPem,
        now,
      }),
    ).toThrow("Preview build input upload is invalid or unavailable.");
  });

  it("stores only a signature-bound body and returns an opaque object reference", async () => {
    const source = buildInput();
    const put = vi.fn(
      async (_input: Parameters<PreviewBuildInputObjectStore["put"]>[0]) =>
        undefined,
    );
    const handler = createPreviewBuildInputUploadHandler({
      publicKeyPem,
      objectStore: { put },
      now: () => now,
    });

    const token = signedToken(source);
    expect(() => handler.authorize(token, source.archive.length + 1)).toThrow(
      "Preview build input upload is invalid or unavailable.",
    );
    const authorization = handler.authorize(token, source.archive.length);
    const response = await handler.handle({
      token,
      contentType: "application/zip",
      archive: source.archive,
      authorization,
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      action: "build-input-upload",
      sourceDigest: source.manifest.sourceDigest,
      archiveDigest: source.archiveDigest,
    });
    expect(body.objectKey).toMatch(
      /^build-inputs\/[a-f0-9]{64}\/[a-f0-9]{64}\.zip$/,
    );
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[0]).toMatchObject({
      archive: source.archive,
      archiveDigest: source.archiveDigest,
      contentLength: source.archive.byteLength,
    });
  });

  it("streams the signed upload contract into the local CAS adapter", async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-local-upload-"));
    try {
      const objectStore = await createLocalPreviewBuildInputObjectStore({
        rootDir: join(parent, "cas"),
        workspaceRoot: process.cwd(),
      });
      const source = buildInput();
      const handler = createPreviewBuildInputUploadHandler({
        publicKeyPem,
        objectStore,
        now: () => now,
      });
      const token = signedToken(source);
      const authorization = handler.authorize(
        token,
        source.archive.byteLength,
      );
      const response = await handler.handle({
        token,
        contentType: "application/zip",
        contentLength: source.archive.byteLength,
        bytes: (async function* () {
          yield source.archive.subarray(0, 13);
          yield source.archive.subarray(13, 47);
          yield source.archive.subarray(47);
        })(),
        authorization,
      });
      const receipt = (await response.json()) as {
        objectKey?: string;
        archiveDigest?: string;
      };

      expect(response.status).toBe(201);
      expect(receipt.archiveDigest).toBe(source.archiveDigest);
      expect(receipt.objectKey).toBe(
        previewBuildInputObjectKey(
          verifyPreviewBuildInputUpload(token, publicKeyPem, now),
        ),
      );
      expect(
        await objectStore.read({
          objectKey: receipt.objectKey!,
          jobId,
          artifactRefId: previewBuildArtifactRefId(jobId, "input"),
        }),
      ).toEqual(
        source.archive,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("does not publish a streamed archive whose digest differs from its signed claim", async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-local-upload-"));
    try {
      const objectStore = await createLocalPreviewBuildInputObjectStore({
        rootDir: join(parent, "cas"),
        workspaceRoot: process.cwd(),
      });
      const source = buildInput();
      const handler = createPreviewBuildInputUploadHandler({
        publicKeyPem,
        objectStore,
        now: () => now,
      });
      const token = signedToken(source);
      const authorization = handler.authorize(
        token,
        source.archive.byteLength,
      );
      const altered = Buffer.from(source.archive);
      altered[altered.length - 1] = altered[altered.length - 1]! ^ 0xff;
      const response = await handler.handle({
        token,
        contentType: "application/zip",
        contentLength: altered.byteLength,
        bytes: (async function* () {
          yield altered.subarray(0, 32);
          yield altered.subarray(32);
        })(),
        authorization,
      });
      const objectKey = previewBuildInputObjectKey(
        verifyPreviewBuildInputUpload(token, publicKeyPem, now),
      );

      expect(response.status).toBe(400);
      await expect(
        objectStore.read({
          objectKey,
          jobId,
          artifactRefId: previewBuildArtifactRefId(jobId, "input"),
        }),
      ).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("keeps an admitted upload valid after token expiry but rejects forged authorization", async () => {
    const source = buildInput();
    const put = vi.fn(
      async (_input: Parameters<PreviewBuildInputObjectStore["put"]>[0]) =>
        undefined,
    );
    let currentTime = now;
    const handler = createPreviewBuildInputUploadHandler({
      publicKeyPem,
      objectStore: { put },
      now: () => currentTime,
    });
    const token = signedToken(source);
    const authorization = handler.authorize(token, source.archive.length);
    currentTime = new Date(now.getTime() + 31_000);

    const admitted = await handler.handle({
      token,
      contentType: "application/zip",
      archive: source.archive,
      authorization,
    });
    const forged = await handler.handle({
      token,
      contentType: "application/zip",
      archive: source.archive,
      authorization: Object.freeze({}),
    });

    expect(admitted.status).toBe(201);
    expect(forged.status).toBe(401);
    expect(put).toHaveBeenCalledOnce();
  });

  it("does not persist a modified or incorrectly typed body", async () => {
    const source = buildInput();
    const put = vi.fn(
      async (_input: Parameters<PreviewBuildInputObjectStore["put"]>[0]) =>
        undefined,
    );
    const handler = createPreviewBuildInputUploadHandler({
      publicKeyPem,
      objectStore: { put },
      now: () => now,
    });

    const token = signedToken(source);
    const authorization = handler.authorize(token, source.archive.length);
    const wrongType = await handler.handle({
      token,
      contentType: "application/octet-stream",
      archive: source.archive,
      authorization,
    });
    expect(wrongType.status).toBe(400);

    const wrongBody = await handler.handle({
      token,
      contentType: "application/zip",
      archive: Buffer.from("different body"),
      authorization,
    });
    expect(wrongBody.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it("maps object-store errors to a generic response without leaking details", async () => {
    const source = buildInput();
    const handler = createPreviewBuildInputUploadHandler({
      publicKeyPem,
      objectStore: {
        put: async () => {
          throw new Error("bucket account secret diagnostic");
        },
      },
      now: () => now,
    });

    const token = signedToken(source);
    const authorization = handler.authorize(token, source.archive.length);
    const response = await handler.handle({
      token,
      contentType: "application/zip",
      archive: source.archive,
      authorization,
    });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("PREVIEW_BUILD_UPLOAD_UNAVAILABLE");
    expect(body).not.toContain("bucket account secret diagnostic");
  });
});
