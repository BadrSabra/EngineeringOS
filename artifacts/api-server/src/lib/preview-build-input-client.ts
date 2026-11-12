import { isIP } from "node:net";
import type { PreviewBuildInputArchive } from "./preview-build-input.js";
import type { PreviewBuildInputIdentity } from "./preview-build-input.js";
import {
  previewBuildInputObjectKeyForArchive,
  signPreviewBuildInputUpload,
} from "./preview-build-upload.js";

const BUILD_INPUT_PATH = "/internal/v1/preview/build-inputs";
const REQUEST_TIMEOUT_MS = 120_000;

export class PreviewBuildInputTransferError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_GATEWAY_URL_INVALID"
      | "PREVIEW_BUILD_SIGNING_UNAVAILABLE"
      | "PREVIEW_BUILD_IDENTITY_MISMATCH"
      | "PREVIEW_BUILD_GATEWAY_UNAVAILABLE"
      | "PREVIEW_BUILD_GATEWAY_RESPONSE_INVALID",
  ) {
    super("Preview build input transfer failed.");
    this.name = "PreviewBuildInputTransferError";
  }
}

function buildInputEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PreviewBuildInputTransferError(
      "PREVIEW_BUILD_GATEWAY_URL_INVALID",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isIP(hostname) !== 0
  ) {
    throw new PreviewBuildInputTransferError(
      "PREVIEW_BUILD_GATEWAY_URL_INVALID",
    );
  }
  return new URL(BUILD_INPUT_PATH, url);
}

function isUploadReceipt(
  value: unknown,
  expected: {
    sourceDigest: string;
    archiveDigest: string;
    objectKey: string;
  },
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.action === "build-input-upload" &&
    record.sourceDigest === expected.sourceDigest &&
    record.archiveDigest === expected.archiveDigest &&
    record.objectKey === expected.objectKey
  );
}

function identitiesMatch(
  left: PreviewBuildInputIdentity,
  right: PreviewBuildInputIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.proposalId === right.proposalId &&
    left.operationId === right.operationId &&
    left.proposalRevision === right.proposalRevision &&
    left.candidateRevision === right.candidateRevision &&
    left.changeSetHash === right.changeSetHash
  );
}

export async function uploadPreviewBuildInput(input: {
  gatewayUrl: string | undefined;
  privateKeyPem: string | undefined;
  identity: PreviewBuildInputIdentity;
  buildInput: PreviewBuildInputArchive;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<{
  sourceDigest: string;
  archiveDigest: string;
  objectKey: string;
}> {
  if (!input.gatewayUrl) {
    throw new PreviewBuildInputTransferError(
      "PREVIEW_BUILD_GATEWAY_URL_INVALID",
    );
  }
  if (!identitiesMatch(input.identity, input.buildInput.manifest)) {
    throw new PreviewBuildInputTransferError("PREVIEW_BUILD_IDENTITY_MISMATCH");
  }
  const url = buildInputEndpoint(input.gatewayUrl);
  let token: string;
  try {
    token = signPreviewBuildInputUpload({
      buildInput: input.buildInput,
      privateKeyPem: input.privateKeyPem,
      now: input.now,
    });
  } catch {
    throw new PreviewBuildInputTransferError(
      "PREVIEW_BUILD_SIGNING_UNAVAILABLE",
    );
  }

  const expected = {
    sourceDigest: input.buildInput.manifest.sourceDigest,
    archiveDigest: input.buildInput.archiveDigest,
    objectKey: previewBuildInputObjectKeyForArchive({
      identity: input.identity,
      sourceDigest: input.buildInput.manifest.sourceDigest,
      archiveDigest: input.buildInput.archiveDigest,
    }),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (input.fetcher ?? fetch)(url, {
      method: "PUT",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/zip",
        accept: "application/json",
        "x-preview-build-token": token,
      },
      body: input.buildInput.archive,
    });
    if (!response.ok) {
      throw new PreviewBuildInputTransferError(
        "PREVIEW_BUILD_GATEWAY_UNAVAILABLE",
      );
    }
    let receipt: unknown;
    try {
      receipt = await response.json();
    } catch {
      throw new PreviewBuildInputTransferError(
        "PREVIEW_BUILD_GATEWAY_RESPONSE_INVALID",
      );
    }
    if (!isUploadReceipt(receipt, expected)) {
      throw new PreviewBuildInputTransferError(
        "PREVIEW_BUILD_GATEWAY_RESPONSE_INVALID",
      );
    }
    return expected;
  } catch (error) {
    if (error instanceof PreviewBuildInputTransferError) throw error;
    throw new PreviewBuildInputTransferError(
      "PREVIEW_BUILD_GATEWAY_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}
