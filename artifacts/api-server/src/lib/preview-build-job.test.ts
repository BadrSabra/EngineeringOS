import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signPreviewBuildJob,
  verifyPreviewBuildJob,
  type PreviewBuildJobClaims,
} from "./preview-build-job.js";

const now = new Date("2026-11-11T12:00:00.000Z");
const keys = generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = keys.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

function claims(): PreviewBuildJobClaims {
  return {
    version: 1,
    action: "preview-build",
    jobId: "11234567-89ab-42cd-8abc-0123456789ab",
    buildId: "01234567-89ab-42cd-8abc-0123456789ab",
    builderProfile: "vite-react-static-v1",
    builderImageDigest: `sha256:${"e".repeat(64)}`,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 3,
    candidateRevision: "a".repeat(64),
    changeSetHash: "b".repeat(64),
    sourceRoot: "web",
    sourceDigest: "c".repeat(64),
    inputArtifactKey: `build-inputs/${"d".repeat(64)}/${"f".repeat(64)}.zip`,
    archiveDigest: "f".repeat(64),
    outputArtifactKey:
      "preview-build-outputs/01234567-89ab-42cd-8abc-0123456789ab/site.tar.gz",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
}

function tokenFor(value = claims()) {
  return signPreviewBuildJob({
    claims: value,
    privateKeyPem,
    now,
  });
}

describe("Preview build job contract", () => {
  it("signs a canonical one-build authorization understood by the isolated Builder", async () => {
    const value = claims();
    const token = tokenFor(value);
    const verified = verifyPreviewBuildJob({
      token,
      publicKeyPem,
      now,
    });
    expect(verified).toEqual(value);
    expect(Object.isFrozen(verified)).toBe(true);

    const builder = await import(
      new URL(
        "../../../../infra/aws-preview/builder/job-contract.mjs",
        import.meta.url,
      ).href
    );
    expect(
      builder.verifyPreviewBuildJobToken(token, publicKeyPem, now),
    ).toEqual(value);
  });

  it("rejects altered signatures, noncanonical payloads, and unsupported fields", () => {
    const token = tokenFor();
    const [payload, signature] = token.split(".");
    const changedSignature = `${signature?.[0] === "A" ? "B" : "A"}${signature?.slice(1)}`;
    expect(() =>
      verifyPreviewBuildJob({
        token: `${payload}.${changedSignature}`,
        publicKeyPem,
        now,
      }),
    ).toThrow("Preview build job is invalid or unavailable.");

    const unknownField = Buffer.from(
      JSON.stringify({ ...claims(), taskRoleArn: "arn:untrusted" }),
    ).toString("base64url");
    expect(() =>
      verifyPreviewBuildJob({
        token: `${unknownField}.${signature}`,
        publicKeyPem,
        now,
      }),
    ).toThrow("Preview build job is invalid or unavailable.");
  });

  it("rejects stale jobs and mismatched artifact paths before signing", () => {
    expect(() =>
      signPreviewBuildJob({
        claims: {
          ...claims(),
          outputArtifactKey:
            "preview-build-outputs/99999999-89ab-42cd-8abc-0123456789ab/site.tar.gz",
        },
        privateKeyPem,
        now,
      }),
    ).toThrow("Preview build job is invalid or unavailable.");

    expect(() =>
      verifyPreviewBuildJob({
        token: tokenFor(),
        publicKeyPem,
        now: new Date("2026-11-11T12:06:00.000Z"),
      }),
    ).toThrow("Preview build job is invalid or unavailable.");
  });
});
