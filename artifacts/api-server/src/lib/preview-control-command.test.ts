import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreviewControlCommandError,
  signPreviewControlCommand,
  verifyPreviewControlCommand,
  type PreviewControlCommand,
} from "./preview-control-command.js";

const now = new Date("2026-11-11T00:00:00.000Z");
const sessionId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:4";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

function startCommand(
  overrides: Partial<Extract<PreviewControlCommand, { action: "start" }>> = {},
) {
  return {
    version: 1,
    action: "start",
    commandId: "88a2ac82-09ee-4f51-b53a-bbf120c4f9e4",
    sessionId,
    stateVersion: 0,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15_000).toISOString(),
    proposalId: "proposal-test",
    proposalRevision: 7,
    candidateRevision: "a".repeat(64),
    changeSetHash: "b".repeat(64),
    outputArtifactKey:
      "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
    outputArtifactDigest: "d".repeat(64),
    imageDigest: `sha256:${"c".repeat(64)}`,
    taskDefinitionArn,
    sessionExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    ...overrides,
  } satisfies Extract<PreviewControlCommand, { action: "start" }>;
}

describe("Preview control command signatures", () => {
  it("verifies signed commands and rejects payload tampering", () => {
    const token = signPreviewControlCommand(startCommand(), privateKeyPem, now);
    expect(verifyPreviewControlCommand(token, publicKeyPem, now)).toEqual(
      startCommand(),
    );

    const [payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...startCommand(), proposalRevision: 8 }),
    ).toString("base64url");
    expect(() =>
      verifyPreviewControlCommand(
        `${tamperedPayload}.${signature}`,
        publicKeyPem,
        now,
      ),
    ).toThrow(PreviewControlCommandError);
    expect(() =>
      verifyPreviewControlCommand(`${payload}.${signature}`, undefined, now),
    ).toThrow(PreviewControlCommandError);
  });

  it("rejects stale, long-lived, malformed, and wrong-key commands", () => {
    const expired = signPreviewControlCommand(
      startCommand({
        issuedAt: new Date(now.getTime() - 40_000).toISOString(),
        expiresAt: new Date(now.getTime() - 10_000).toISOString(),
      }),
      privateKeyPem,
      new Date(now.getTime() - 40_000),
    );
    expect(() =>
      verifyPreviewControlCommand(expired, publicKeyPem, now),
    ).toThrow(/invalid or unavailable/i);

    expect(() =>
      signPreviewControlCommand(
        startCommand({
          expiresAt: new Date(now.getTime() + 31_000).toISOString(),
        }),
        privateKeyPem,
        now,
      ),
    ).toThrow(PreviewControlCommandError);

    const otherPair = generateKeyPairSync("ed25519");
    const otherPublicKey = otherPair.publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    const valid = signPreviewControlCommand(startCommand(), privateKeyPem, now);
    expect(() =>
      verifyPreviewControlCommand(valid, otherPublicKey, now),
    ).toThrow(PreviewControlCommandError);
  });

  it("rejects non-Ed25519 signing keys", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPrivateKey = rsa.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
    expect(() =>
      signPreviewControlCommand(startCommand(), rsaPrivateKey, now),
    ).toThrow(expect.objectContaining({ code: "PREVIEW_CONTROL_KEY_INVALID" }));
  });

  it("rejects output keys and digests that are not scoped to immutable build outputs", () => {
    expect(() =>
      signPreviewControlCommand(
        startCommand({ outputArtifactKey: "build-inputs/secret.zip" }),
        privateKeyPem,
        now,
      ),
    ).toThrow(PreviewControlCommandError);
    expect(() =>
      signPreviewControlCommand(
        startCommand({ outputArtifactDigest: "../not-a-digest" }),
        privateKeyPem,
        now,
      ),
    ).toThrow(PreviewControlCommandError);
  });
});
