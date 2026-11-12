import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalPreviewAgentPublicKeyPem,
  createPreviewAgentPairingCode,
  hashPreviewAgentPairingCode,
  previewAgentPairingProofPayload,
  previewAgentPublicKeyFingerprint,
  verifyPreviewAgentPairingProof,
} from "./preview-agent-pairing-crypto.js";

const keyPair = generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const pairing = {
  nodeId: "d69b66c5-9cb9-4c9a-ae60-1cc578c40700",
  storeId: "e3397306-4254-4a5c-a5e8-3a48968751dd",
  expiresAt: new Date("2031-03-04T12:10:00.000Z"),
};

describe("Preview Agent pairing cryptography", () => {
  it("creates a high-entropy one-time code and stores only a fixed digest", () => {
    const first = createPreviewAgentPairingCode();
    const second = createPreviewAgentPairingCode();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashPreviewAgentPairingCode(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds proof of key possession to the exact code, node, store, and expiry", () => {
    const pairingCode = createPreviewAgentPairingCode();
    const proof = sign(
      null,
      previewAgentPairingProofPayload({
      ...pairing,
      pairingCode,
      }),
      keyPair.privateKey,
    ).toString("base64url");
    expect(
      verifyPreviewAgentPairingProof({
        ...pairing,
        pairingCode,
        publicKeyPem,
        proof,
      }),
    ).toBe(previewAgentPublicKeyFingerprint(publicKeyPem));

    expect(() =>
      verifyPreviewAgentPairingProof({
        ...pairing,
        pairingCode,
        storeId: "94cc6266-181a-44f9-90f8-bdd21ebcc748",
        publicKeyPem,
        proof,
      }),
    ).toThrow();
  });

  it("normalizes public key storage and rejects malformed pairing codes", () => {
    const pairingCode = createPreviewAgentPairingCode();
    expect(canonicalPreviewAgentPublicKeyPem(publicKeyPem)).toBe(publicKeyPem);
    expect(() => hashPreviewAgentPairingCode("../not-a-pairing-code")).toThrow();
    const signature = sign(
      null,
      previewAgentPairingProofPayload({ ...pairing, pairingCode }),
      keyPair.privateKey,
    ).toString("base64url");
    expect(signature).toHaveLength(86);
  });
});
