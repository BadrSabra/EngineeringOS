import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signPreviewBuildObservation,
  verifyPreviewBuildObservation,
  type PreviewBuildObservationClaims,
} from "./preview-build-observation-command.js";

const now = new Date("2026-11-12T13:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";

function claims(
  overrides: Partial<PreviewBuildObservationClaims> = {},
): PreviewBuildObservationClaims {
  return {
    version: 1,
    action: "preview-build-observe",
    jobId,
    buildId,
    builderImageDigest: `sha256:${"a".repeat(64)}`,
    outputArtifactKey: `preview-build-outputs/${buildId}/g1/site.tar.gz`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 20_000).toISOString(),
    ...overrides,
  };
}

describe("signed Preview build observation command", () => {
  it("binds a short-lived observation to the exact build, image, and task", () => {
    const command = claims({
      taskArn:
        "arn:aws:ecs:eu-central-1:123456789012:task/builder/abcdef0123456789abcdef0123456789",
    });
    const token = signPreviewBuildObservation({
      claims: command,
      privateKeyPem,
      now,
    });
    expect(
      verifyPreviewBuildObservation({
        token,
        publicKeyPem,
        now: new Date(now.getTime() + 1_000),
      }),
    ).toEqual(command);
  });

  it("rejects a stale command and tampered task identity", () => {
    const token = signPreviewBuildObservation({
      claims: claims(),
      privateKeyPem,
      now,
    });
    expect(() =>
      verifyPreviewBuildObservation({
        token,
        publicKeyPem,
        now: new Date(now.getTime() + 21_000),
      }),
    ).toThrow();
    const [payload, signature] = token.split(".");
    const altered = Buffer.from(payload!, "base64url")
      .toString("utf8")
      .replace(jobId, "323e4567-e89b-42d3-a456-426614174002");
    const tampered = `${Buffer.from(altered).toString("base64url")}.${signature}`;
    expect(() =>
      verifyPreviewBuildObservation({
        token: tampered,
        publicKeyPem,
        now,
      }),
    ).toThrow();
  });

  it("rejects output keys not bound to buildId and overlong expiry", () => {
    expect(() =>
      signPreviewBuildObservation({
        claims: claims({
          outputArtifactKey:
            "preview-build-outputs/323e4567-e89b-42d3-a456-426614174002/site.tar.gz",
        }),
        privateKeyPem,
        now,
      }),
    ).toThrow();
    expect(() =>
      signPreviewBuildObservation({
        claims: claims({
          expiresAt: new Date(now.getTime() + 31_000).toISOString(),
        }),
        privateKeyPem,
        now,
      }),
    ).toThrow();
  });
});
