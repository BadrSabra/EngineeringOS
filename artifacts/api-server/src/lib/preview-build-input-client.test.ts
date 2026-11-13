import { createHash, generateKeyPairSync } from "node:crypto";
import AdmZip from "adm-zip";
import { describe, expect, it, vi } from "vitest";
import {
  uploadPreviewBuildInput,
  PreviewBuildInputTransferError,
} from "./preview-build-input-client.js";
import {
  createPreviewBuildInputUploadHandler,
  previewBuildInputObjectKeyForArchive,
  verifyPreviewBuildInputUpload,
} from "./preview-build-upload.js";
import {
  PREVIEW_BUILD_INPUT_MANIFEST_PATH,
  type PreviewBuildInputArchive,
  type PreviewBuildInputIdentity,
} from "./preview-build-input.js";
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

const candidateIdentity: PreviewBuildInputIdentity = {
  projectId: "project-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 4,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
};

function buildInputArchiveFixture(): PreviewBuildInputArchive {
  const fileBytes = Buffer.from("candidate");
  const indexBytes = Buffer.from("<div id=\"root\"></div>");
  const sourceRoot = ".";
  const files = [
    {
      path: "index.html",
      size: indexBytes.length,
      sha256: createHash("sha256").update(indexBytes).digest("hex"),
    },
    {
      path: "src/main.tsx",
      size: fileBytes.length,
      sha256: createHash("sha256").update(fileBytes).digest("hex"),
    },
  ];
  const manifest = {
    version: 1 as const,
    builderProfile: "vite-react-static-v1" as const,
    ...candidateIdentity,
    sourceRoot,
    sourceDigest: createHash("sha256")
      .update(JSON.stringify({ sourceRoot, files }))
      .digest("hex"),
    files,
  };
  const zip = new AdmZip();
  zip.addFile("index.html", indexBytes);
  zip.addFile("src/main.tsx", fileBytes);
  zip.addFile(
    PREVIEW_BUILD_INPUT_MANIFEST_PATH,
    Buffer.from(JSON.stringify(manifest), "utf8"),
  );
  const archive = zip.toBuffer();
  return {
    archive,
    archiveDigest: createHash("sha256").update(archive).digest("hex"),
    manifest,
    totalBytes: fileBytes.length + indexBytes.length,
  };
}

describe("Preview build-input Gateway client", () => {
  it("sends a short-lived signed archive over HTTPS and validates the receipt", async () => {
    const buildInput = buildInputArchiveFixture();
    const objectKey = previewBuildInputObjectKeyForArchive({
      identity: candidateIdentity,
      sourceDigest: buildInput.manifest.sourceDigest,
      archiveDigest: buildInput.archiveDigest,
    });
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.toString()).toBe(
        "https://preview.example.com/internal/v1/preview/build-inputs",
      );
      expect(init?.method).toBe("PUT");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(init?.cache).toBe("no-store");
      expect(init?.body).toEqual(buildInput.archive);
      const headers = new Headers(init?.headers);
      const claims = verifyPreviewBuildInputUpload(
        headers.get("x-preview-build-token") ?? "",
        publicKeyPem,
        now,
      );
      expect(claims).toMatchObject(candidateIdentity);
      return Response.json({
        action: "build-input-upload",
        jobId,
        artifactRefId: previewBuildArtifactRefId(jobId, "input"),
        sourceDigest: buildInput.manifest.sourceDigest,
        archiveDigest: buildInput.archiveDigest,
        objectKey,
      });
    });

    await expect(
      uploadPreviewBuildInput({
        gatewayUrl: "https://preview.example.com/",
        privateKeyPem,
        jobId,
        identity: candidateIdentity,
        buildInput,
        fetcher,
        now,
      }),
    ).resolves.toEqual({
      jobId,
      artifactRefId: previewBuildArtifactRefId(jobId, "input"),
      sourceDigest: buildInput.manifest.sourceDigest,
      archiveDigest: buildInput.archiveDigest,
      objectKey,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("completes the signed client-to-Gateway-to-object-store contract", async () => {
    const buildInput = buildInputArchiveFixture();
    const put = vi.fn(
      async (_input: {
        jobId: string;
        artifactRefId: string;
        objectKey: string;
        archive: Buffer;
        archiveDigest: string;
        contentLength: number;
      }) => undefined,
    );
    const gatewayUpload = createPreviewBuildInputUploadHandler({
      publicKeyPem,
      objectStore: { put },
      now: () => now,
    });
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const archive = Buffer.from(await new Response(init?.body).arrayBuffer());
      const token = headers.get("x-preview-build-token") ?? "";
      const authorization = gatewayUpload.authorize(token, archive.length);
      return gatewayUpload.handle({
        token,
        contentType: headers.get("content-type") ?? undefined,
        archive,
        authorization,
      });
    });

    const receipt = await uploadPreviewBuildInput({
      gatewayUrl: "https://preview.example.com",
      privateKeyPem,
      jobId,
      identity: candidateIdentity,
      buildInput,
      fetcher,
      now,
    });

    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[0]).toMatchObject({
      objectKey: receipt.objectKey,
      archive: buildInput.archive,
      archiveDigest: buildInput.archiveDigest,
      contentLength: buildInput.archive.length,
    });
    expect(receipt.objectKey).toMatch(
      /^build-inputs\/[a-f0-9]{64}\/[a-f0-9]{64}\.zip$/,
    );
  });

  it("rejects insecure Gateway locations and mismatched Candidate identities before sending", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    const buildInput = buildInputArchiveFixture();

    await expect(
      uploadPreviewBuildInput({
        gatewayUrl: "http://preview.example.com/",
        privateKeyPem,
        jobId,
        identity: candidateIdentity,
        buildInput,
        fetcher,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_GATEWAY_URL_INVALID",
    });
    await expect(
      uploadPreviewBuildInput({
        gatewayUrl: "https://preview.example.com/",
        privateKeyPem,
        jobId,
        identity: { ...candidateIdentity, projectId: "other-project" },
        buildInput,
        fetcher,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_IDENTITY_MISMATCH",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not accept a Gateway receipt for different bytes or a failed response", async () => {
    const buildInput = buildInputArchiveFixture();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          action: "build-input-upload",
          jobId,
          artifactRefId: previewBuildArtifactRefId(jobId, "input"),
          sourceDigest: buildInput.manifest.sourceDigest,
          archiveDigest: "c".repeat(64),
          objectKey: "build-inputs/wrong",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "ignored" }, { status: 503 }),
      );
    const request = {
      gatewayUrl: "https://preview.example.com/",
      privateKeyPem,
      jobId,
      identity: candidateIdentity,
      buildInput,
      fetcher: fetcher as typeof fetch,
      now,
    };

    await expect(uploadPreviewBuildInput(request)).rejects.toBeInstanceOf(
      PreviewBuildInputTransferError,
    );
    await expect(uploadPreviewBuildInput(request)).rejects.toMatchObject({
      code: "PREVIEW_BUILD_GATEWAY_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
