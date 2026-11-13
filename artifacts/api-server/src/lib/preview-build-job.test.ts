import { generateKeyPairSync, sign as signBytes } from "node:crypto";
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
    version: 2,
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
      "preview-build-outputs/01234567-89ab-42cd-8abc-0123456789ab/g1/site.tar.gz",
    attemptId: "11234567-89ab-42cd-8abc-0123456789ab",
    idempotencyKey: "21234567-89ab-42cd-8abc-0123456789ab",
    dispatchGeneration: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
}

function legacyTokenFor(): string {
  const current = claims();
  const legacy = {
    version: 1,
    action: current.action,
    jobId: current.jobId,
    buildId: current.buildId,
    builderProfile: current.builderProfile,
    builderImageDigest: current.builderImageDigest,
    projectId: current.projectId,
    proposalId: current.proposalId,
    operationId: current.operationId,
    proposalRevision: current.proposalRevision,
    candidateRevision: current.candidateRevision,
    changeSetHash: current.changeSetHash,
    sourceRoot: current.sourceRoot,
    sourceDigest: current.sourceDigest,
    inputArtifactKey: current.inputArtifactKey,
    archiveDigest: current.archiveDigest,
    outputArtifactKey:
      "preview-build-outputs/01234567-89ab-42cd-8abc-0123456789ab/site.tar.gz",
    issuedAt: current.issuedAt,
    expiresAt: current.expiresAt,
  };
  const payload = Buffer.from(JSON.stringify(legacy), "utf8");
  const signature = signBytes(
    null,
    Buffer.concat([
      Buffer.from("EngineeringOS Preview Build Job v1\n", "utf8"),
      payload,
    ]),
    privateKeyPem,
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
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

  it("requires V2 output paths to match the signed dispatch generation", () => {
    const generationTwo = {
      ...claims(),
      dispatchGeneration: 2,
    };
    expect(() =>
      signPreviewBuildJob({
        claims: generationTwo,
        privateKeyPem,
        now,
      }),
    ).toThrow("Preview build job is invalid or unavailable.");

    const current = {
      ...generationTwo,
      outputArtifactKey:
        "preview-build-outputs/01234567-89ab-42cd-8abc-0123456789ab/g2/site.tar.gz",
    };
    expect(
      verifyPreviewBuildJob({
        token: tokenFor(current),
        publicKeyPem,
        now,
      }),
    ).toMatchObject({ dispatchGeneration: 2, outputArtifactKey: current.outputArtifactKey });
  });

  it("continues to verify short-lived v1 jobs without issuing new ones", async () => {
    const token = legacyTokenFor();
    expect(
      verifyPreviewBuildJob({
        token,
        publicKeyPem,
        now,
      }),
    ).toMatchObject({
      version: 1,
      jobId: "11234567-89ab-42cd-8abc-0123456789ab",
    });

    const builder = await import(
      new URL(
        "../../../../infra/aws-preview/builder/job-contract.mjs",
        import.meta.url,
      ).href
    );
    expect(
      builder.verifyPreviewBuildJobToken(token, publicKeyPem, now),
    ).toMatchObject({ version: 1 });
  });
});
