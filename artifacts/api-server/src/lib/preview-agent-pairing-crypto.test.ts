import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalPreviewAgentPublicKeyPem,
  createPreviewAgentHeartbeatChallenge,
  createPreviewAgentPairingCode,
  hashPreviewAgentHeartbeatChallenge,
  hashPreviewAgentPairingCode,
  previewAgentHeartbeatChallengeRequestPayload,
  previewAgentHeartbeatProofPayload,
  previewAgentPairingProofPayload,
  previewAgentPublicKeyFingerprint,
  verifyPreviewAgentHeartbeatChallengeRequest,
  verifyPreviewAgentHeartbeatProof,
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
const heartbeat = {
  version: 1 as const,
  action: "preview-agent-heartbeat" as const,
  nodeId: pairing.nodeId,
  keyVersion: 1,
  sequence: 7,
};
const heartbeatChallengeRequest = {
  version: 1 as const,
  action: "request-preview-agent-heartbeat-challenge" as const,
  nodeId: pairing.nodeId,
  keyVersion: 1,
  sequence: 7,
  nonce: "8a42c6b1-5d54-4d4b-a854-64453c037d43",
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

  it("binds one-use heartbeat challenges to node, key version, and sequence", () => {
    const challenge = createPreviewAgentHeartbeatChallenge();
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashPreviewAgentHeartbeatChallenge(challenge)).toMatch(
      /^[a-f0-9]{64}$/,
    );

    const proof = sign(
      null,
      previewAgentHeartbeatProofPayload({ ...heartbeat, challenge }),
      keyPair.privateKey,
    ).toString("base64url");
    expect(
      verifyPreviewAgentHeartbeatProof({
        ...heartbeat,
        challenge,
        publicKeyPem,
        signature: proof,
      }),
    ).toBe(previewAgentPublicKeyFingerprint(publicKeyPem));

    expect(() =>
      verifyPreviewAgentHeartbeatProof({
        ...heartbeat,
        sequence: heartbeat.sequence + 1,
        challenge,
        publicKeyPem,
        signature: proof,
      }),
    ).toThrow();
    expect(() => hashPreviewAgentHeartbeatChallenge("not-a-challenge")).toThrow();
  });

  it("authenticates challenge issuance with the same registered Agent key", () => {
    const signature = sign(
      null,
      previewAgentHeartbeatChallengeRequestPayload(heartbeatChallengeRequest),
      keyPair.privateKey,
    ).toString("base64url");
    expect(
      verifyPreviewAgentHeartbeatChallengeRequest({
        ...heartbeatChallengeRequest,
        publicKeyPem,
        signature,
      }),
    ).toBe(previewAgentPublicKeyFingerprint(publicKeyPem));
    expect(() =>
      verifyPreviewAgentHeartbeatChallengeRequest({
        ...heartbeatChallengeRequest,
        sequence: heartbeatChallengeRequest.sequence + 1,
        publicKeyPem,
        signature,
      }),
    ).toThrow();
  });
});
