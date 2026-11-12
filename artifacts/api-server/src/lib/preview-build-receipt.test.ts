import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalPreviewBuildReceiptPayload,
  isVerifiedPreviewBuildReceipt,
  verifyPreviewBuildReceipt,
  type PreviewBuildReceiptClaims,
} from "./preview-build-receipt.js";
import type { PreviewBuildInputIdentity } from "./preview-build-input.js";

const now = new Date("2026-11-11T12:00:00.000Z");
const keyPair = generateKeyPairSync("ed25519");
const privateKey = keyPair.privateKey;
const publicKeyPem = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const SIGNING_DOMAIN = Buffer.from(
  "EngineeringOS Preview Build Receipt v1\n",
  "utf8",
);

const identity: PreviewBuildInputIdentity = {
  projectId: "project-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 3,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
};

const expected = {
  identity,
  sourceDigest: "c".repeat(64),
  archiveDigest: "d".repeat(64),
  builderImageDigest: `sha256:${"e".repeat(64)}`,
  buildId: "223e4567-e89b-42d3-a456-426614174001",
  outputArtifactKey:
    "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/site.tar.gz",
};

function receipt(): PreviewBuildReceiptClaims {
  return {
    version: 1,
    action: "preview-build-ready",
    receiptId: "123e4567-e89b-42d3-a456-426614174000",
    buildId: expected.buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest: expected.builderImageDigest,
    ...identity,
    sourceDigest: expected.sourceDigest,
    archiveDigest: expected.archiveDigest,
    buildOutputDigest: "f".repeat(64),
    outputArtifactKey: expected.outputArtifactKey,
    issuedAt: "2026-11-11T12:00:00.000Z",
    expiresAt: "2026-11-11T12:02:00.000Z",
  };
}

function signReceipt(value: PreviewBuildReceiptClaims): string {
  const payload = Buffer.from(canonicalPreviewBuildReceiptPayload(value));
  const signature = signBytes(
    null,
    Buffer.concat([SIGNING_DOMAIN, payload]),
    privateKey,
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

describe("Preview Build Receipt verification", () => {
  it("accepts a trusted receipt bound to the exact Candidate and build inputs", () => {
    const claims = receipt();
    const verified = verifyPreviewBuildReceipt({
      token: signReceipt(claims),
      publicKeyPem,
      expected,
      now,
    });

    expect(verified).toEqual(claims);
    expect(isVerifiedPreviewBuildReceipt(verified)).toBe(true);
    expect(isVerifiedPreviewBuildReceipt(claims)).toBe(false);
    expect(isVerifiedPreviewBuildReceipt({ ...verified })).toBe(false);
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it("rejects signature tampering and non-canonical signed payloads", () => {
    const token = signReceipt(receipt());
    const [payload, signature] = token.split(".");
    const altered = Buffer.from(
      JSON.stringify({
        ...receipt(),
        buildOutputDigest: "2".repeat(64),
      }),
    ).toString("base64url");
    expect(() =>
      verifyPreviewBuildReceipt({
        token: `${altered}.${signature}`,
        publicKeyPem,
        expected,
        now,
      }),
    ).toThrow("Preview build receipt is invalid or unavailable.");
    expect(() =>
      verifyPreviewBuildReceipt({
        token: `${payload}=.${signature}`,
        publicKeyPem,
        expected,
        now,
      }),
    ).toThrow("Preview build receipt is invalid or unavailable.");
  });

  it("rejects receipts for another Candidate, source, archive, build, artifact, or builder", () => {
    const claims = receipt();
    const cases = [
      {
        ...expected,
        identity: { ...identity, projectId: "another-project" },
      },
      { ...expected, sourceDigest: "9".repeat(64) },
      { ...expected, archiveDigest: "8".repeat(64) },
      { ...expected, buildId: "323e4567-e89b-42d3-a456-426614174002" },
      {
        ...expected,
        outputArtifactKey:
          "preview-build-outputs/323e4567-e89b-42d3-a456-426614174002/site.tar.gz",
      },
      { ...expected, builderImageDigest: `sha256:${"7".repeat(64)}` },
    ];

    for (const mismatch of cases) {
      expect(() =>
        verifyPreviewBuildReceipt({
          token: signReceipt(claims),
          publicKeyPem,
          expected: mismatch,
          now,
        }),
      ).toThrow("Preview build receipt is invalid or unavailable.");
    }
  });

  it("fails closed when the server-side artifact or builder binding is malformed", () => {
    const token = signReceipt(receipt());
    for (const invalidExpected of [
      { ...expected, outputArtifactKey: "../other-project/site.tar.gz" },
      { ...expected, builderImageDigest: "latest" },
    ]) {
      expect(() =>
        verifyPreviewBuildReceipt({
          token,
          publicKeyPem,
          expected: invalidExpected,
          now,
        }),
      ).toThrow("Preview build receipt is invalid or unavailable.");
    }
  });

  it("rejects an expired receipt and a payload with unsupported fields", () => {
    const expired = {
      ...receipt(),
      expiresAt: "2026-11-11T12:00:30.000Z",
    };
    expect(() =>
      verifyPreviewBuildReceipt({
        token: signReceipt(expired),
        publicKeyPem,
        expected,
        now: new Date("2026-11-11T12:00:31.000Z"),
      }),
    ).toThrow("Preview build receipt is invalid or unavailable.");

    const unsupported = {
      ...receipt(),
      imageDigest: `sha256:${"9".repeat(64)}`,
    };
    const payload = Buffer.from(JSON.stringify(unsupported));
    const signature = signBytes(
      null,
      Buffer.concat([SIGNING_DOMAIN, payload]),
      privateKey,
    );
    expect(() =>
      verifyPreviewBuildReceipt({
        token: `${payload.toString("base64url")}.${signature.toString("base64url")}`,
        publicKeyPem,
        expected,
        now,
      }),
    ).toThrow("Preview build receipt is invalid or unavailable.");
  });
});
