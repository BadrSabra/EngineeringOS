import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreviewArtifactGcCommandError,
  previewArtifactDeleteCommandFingerprint,
  signPreviewArtifactDeleteCommand,
  signPreviewArtifactDeleteReceipt,
  verifyPreviewArtifactDeleteCommand,
  verifyPreviewArtifactDeleteReceipt,
  type PreviewArtifactDeleteCommandClaims,
  type PreviewArtifactDeleteReceiptClaims,
} from "./preview-artifact-gc-command.js";
import { MAX_PREVIEW_BUILD_ARCHIVE_BYTES } from "./preview-build-upload.js";

const NOW = new Date("2031-03-04T12:00:00.000Z");
const API_KEYS = generateKeyPairSync("ed25519");
const OWNER_KEYS = generateKeyPairSync("ed25519");
const OTHER_KEYS = generateKeyPairSync("ed25519");
const API_PRIVATE = API_KEYS.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const API_PUBLIC = API_KEYS.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const OWNER_PRIVATE = OWNER_KEYS.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const OWNER_PUBLIC = OWNER_KEYS.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const OTHER_PUBLIC = OTHER_KEYS.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

function validCommand(
  overrides: Partial<PreviewArtifactDeleteCommandClaims> = {},
): PreviewArtifactDeleteCommandClaims {
  return {
    version: 1,
    action: "delete-artifact",
    commandId: "d69b66c5-9cb9-4c9a-ae60-1cc578c40700",
    storeId: "e3397306-4254-4a5c-a5e8-3a48968751dd",
    artifactRefId: "4e97df98-4389-4c61-8c8d-cab6814f0bea",
    jobId: "8860f36d-5f3b-4fa9-a526-0c8e706ebc6a",
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 7,
    candidateRevision: "a".repeat(64),
    changeSetHash: "b".repeat(64),
    artifactKind: "preview-build-input",
    artifactDigest: "c".repeat(64),
    sizeBytes: 1024,
    manifestDigest: "d".repeat(64),
    retentionPolicy: "preview-build-input-24h-v1",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    ...overrides,
  };
}

function signedCommand(
  claims = validCommand(),
  privateKeyPem = API_PRIVATE,
): string {
  return signPreviewArtifactDeleteCommand({
    claims,
    privateKeyPem,
    now: NOW,
  });
}

function validReceipt(
  command: PreviewArtifactDeleteCommandClaims,
  overrides: Partial<PreviewArtifactDeleteReceiptClaims> = {},
): PreviewArtifactDeleteReceiptClaims {
  return {
    version: 1,
    action: "artifact-delete-receipt",
    commandId: command.commandId,
    commandFingerprint: previewArtifactDeleteCommandFingerprint(command),
    storeId: command.storeId,
    artifactRefId: command.artifactRefId,
    artifactDigest: command.artifactDigest,
    manifestDigest: command.manifestDigest,
    result: "deleted",
    completedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("Preview artifact delete command contract", () => {
  it("round-trips a short-lived command with exact Candidate and store binding", () => {
    const claims = validCommand();
    const token = signedCommand(claims);

    expect(
      verifyPreviewArtifactDeleteCommand({
        token,
        publicKeyPem: API_PUBLIC,
        now: NOW,
      }),
    ).toEqual(claims);
  });

  it("keeps the retry fingerprint stable when only the signed time window changes", () => {
    const first = validCommand();
    const retry = validCommand({
      issuedAt: new Date(NOW.getTime() + 2_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 32_000).toISOString(),
    });

    expect(previewArtifactDeleteCommandFingerprint(retry)).toBe(
      previewArtifactDeleteCommandFingerprint(first),
    );
    expect(signedCommand(retry)).not.toBe(signedCommand(first));
  });

  it("rejects a command signed by an untrusted key or with a changed target", () => {
    const token = signedCommand();
    expect(() =>
      verifyPreviewArtifactDeleteCommand({
        token,
        publicKeyPem: OTHER_PUBLIC,
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_GC_COMMAND_SIGNATURE_INVALID",
      }),
    );

    const parts = token.split(".");
    const payload = Buffer.from(parts[0]!, "base64url");
    const claims = JSON.parse(payload.toString("utf8")) as Record<
      string,
      unknown
    >;
    claims.storeId = "a35e8743-0bd4-4b9e-bc13-e2365743ea1a";
    const tampered = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${parts[1]}`;
    expect(() =>
      verifyPreviewArtifactDeleteCommand({
        token: tampered,
        publicKeyPem: API_PUBLIC,
        now: NOW,
      }),
    ).toThrowError(PreviewArtifactGcCommandError);
  });

  it("rejects expired, overlong, and path-bearing commands", () => {
    const expired = validCommand({
      issuedAt: new Date(NOW.getTime() - 90_000).toISOString(),
      expiresAt: new Date(NOW.getTime() - 30_000).toISOString(),
    });
    expect(() => signedCommand(expired)).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_GC_COMMAND_EXPIRED",
      }),
    );

    const overlong = validCommand({
      expiresAt: new Date(NOW.getTime() + 60_001).toISOString(),
    });
    expect(() => signedCommand(overlong)).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_GC_COMMAND_EXPIRED",
      }),
    );

    const pathBearing = {
      ...validCommand(),
      filesystemPath: "/tmp/candidate-output",
    };
    expect(() =>
      signPreviewArtifactDeleteCommand({
        claims:
          pathBearing as unknown as PreviewArtifactDeleteCommandClaims,
        privateKeyPem: API_PRIVATE,
        now: NOW,
      }),
    ).toThrowError(PreviewArtifactGcCommandError);

    expect(() =>
      signedCommand(
        validCommand({ sizeBytes: MAX_PREVIEW_BUILD_ARCHIVE_BYTES + 1 }),
      ),
    ).toThrowError(PreviewArtifactGcCommandError);
  });

  it("accepts a matching owner receipt and rejects receipts for another reference", () => {
    const command = validCommand();
    const token = signPreviewArtifactDeleteReceipt({
      claims: validReceipt(command, { result: "already_deleted" }),
      privateKeyPem: OWNER_PRIVATE,
      now: NOW,
    });
    expect(
      verifyPreviewArtifactDeleteReceipt({
        token,
        publicKeyPem: OWNER_PUBLIC,
        command,
        now: NOW,
      }).result,
    ).toBe("already_deleted");

    const wrongReference = validCommand({
      artifactRefId: "94cc6266-181a-44f9-90f8-bdd21ebcc748",
    });
    expect(() =>
      verifyPreviewArtifactDeleteReceipt({
        token,
        publicKeyPem: OWNER_PUBLIC,
        command: wrongReference,
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
      }),
    );
  });

  it("rejects receipts from the wrong owner key and receipts past their validity window", () => {
    const command = validCommand();
    const token = signPreviewArtifactDeleteReceipt({
      claims: validReceipt(command),
      privateKeyPem: OWNER_PRIVATE,
      now: NOW,
    });
    expect(() =>
      verifyPreviewArtifactDeleteReceipt({
        token,
        publicKeyPem: OTHER_PUBLIC,
        command,
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_GC_RECEIPT_SIGNATURE_INVALID",
      }),
    );

    const staleAt = new Date(NOW.getTime() - 6 * 60_000);
    const staleToken = signPreviewArtifactDeleteReceipt({
      claims: validReceipt(command, {
        completedAt: staleAt.toISOString(),
      }),
      privateKeyPem: OWNER_PRIVATE,
      now: staleAt,
    });
    expect(() =>
      verifyPreviewArtifactDeleteReceipt({
        token: staleToken,
        publicKeyPem: OWNER_PUBLIC,
        command,
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_GC_RECEIPT_EXPIRED",
      }),
    );
  });
});
