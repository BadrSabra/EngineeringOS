import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
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
} from "./preview-agent-crypto.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const identity = {
  nodeId: "d69b66c5-9cb9-4c9a-ae60-1cc578c40700",
  storeId: "e3397306-4254-4a5c-a5e8-3a48968751dd",
};

describe("shared Preview Agent cryptographic contract", () => {
  it("generates high-entropy one-time values and hashes only valid encodings", () => {
    const code = createPreviewAgentPairingCode();
    const challenge = createPreviewAgentHeartbeatChallenge();

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashPreviewAgentPairingCode(code)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPreviewAgentHeartbeatChallenge(challenge)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(() => hashPreviewAgentPairingCode("../invalid")).toThrow();
    expect(() => hashPreviewAgentHeartbeatChallenge("invalid")).toThrow();
  });

  it("binds pairing proof to the exact node, store, code, and expiry", () => {
    const pairingCode = createPreviewAgentPairingCode();
    const expiresAt = new Date("2031-03-04T12:10:00.000Z");
    const payload = previewAgentPairingProofPayload({
      ...identity,
      pairingCode,
      expiresAt,
    });
    const proof = sign(null, payload, privateKey).toString("base64url");

    expect(
      verifyPreviewAgentPairingProof({
        ...identity,
        pairingCode,
        expiresAt,
        publicKeyPem,
        proof,
      }),
    ).toBe(previewAgentPublicKeyFingerprint(publicKeyPem));
    expect(() =>
      verifyPreviewAgentPairingProof({
        ...identity,
        nodeId: "94cc6266-181a-44f9-90f8-bdd21ebcc748",
        pairingCode,
        expiresAt,
        publicKeyPem,
        proof,
      }),
    ).toThrow();
  });

  it("requires signed sequence-bound heartbeat challenge and proof payloads", () => {
    const request = {
      nodeId: identity.nodeId,
      keyVersion: 1,
      sequence: 7,
      nonce: "8a42c6b1-5d54-4d4b-a854-64453c037d43",
    };
    const requestSignature = sign(
      null,
      previewAgentHeartbeatChallengeRequestPayload(request),
      privateKey,
    ).toString("base64url");
    expect(
      verifyPreviewAgentHeartbeatChallengeRequest({
        ...request,
        publicKeyPem,
        signature: requestSignature,
      }),
    ).toBe(previewAgentPublicKeyFingerprint(publicKeyPem));

    const challenge = createPreviewAgentHeartbeatChallenge();
    const heartbeat = {
      version: 1 as const,
      action: "preview-agent-heartbeat" as const,
      nodeId: identity.nodeId,
      keyVersion: 1,
      sequence: 7,
      challenge,
    };
    const heartbeatSignature = sign(
      null,
      previewAgentHeartbeatProofPayload(heartbeat),
      privateKey,
    ).toString("base64url");
    expect(
      verifyPreviewAgentHeartbeatProof({
        ...heartbeat,
        publicKeyPem,
        signature: heartbeatSignature,
      }),
    ).toBe(previewAgentPublicKeyFingerprint(publicKeyPem));
    expect(() =>
      verifyPreviewAgentHeartbeatProof({
        ...heartbeat,
        sequence: 8,
        publicKeyPem,
        signature: heartbeatSignature,
      }),
    ).toThrow();
  });
});
