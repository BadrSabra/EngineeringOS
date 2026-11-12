import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreviewRunnerMessageError,
  isVerifiedPreviewRunnerMessageV1,
  signPreviewRunnerMessageV1,
  verifyPreviewRunnerMessageV1,
  type ExpectedPreviewRunnerMessageBindingV1,
  type PreviewRunnerObservationV1,
  type PreviewRunnerStartAckV1,
  type PreviewRunnerStopAckV1,
} from "./runner-message.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const UUID_E = "55555555-5555-4555-8555-555555555555";
const UUID_F = "66666666-6666-4666-8666-666666666666";

const keys = generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey.export({
  type: "pkcs8",
  format: "pem",
}).toString();
const publicKeyPem = keys.publicKey.export({
  type: "spki",
  format: "pem",
}).toString();
const otherKeys = generateKeyPairSync("ed25519");
const otherPublicKeyPem = otherKeys.publicKey.export({
  type: "spki",
  format: "pem",
}).toString();

function commonFields() {
  return {
    protocolVersion: 1 as const,
    messageId: UUID_A,
    keyId: "node-key-v1",
    nodeId: "runner-linux-01",
    commandId: UUID_B,
    idempotencyKey: UUID_C,
    sessionId: UUID_D,
    stateVersion: 1,
    executionGeneration: 2,
    fencingGeneration: 3,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 4,
    baseRevision: HASH_A,
    candidateRevision: HASH_B,
    changeSetHash: HASH_C,
    buildReceiptId: UUID_E,
    runtimeProfileDigest: HASH_D,
    artifactDigest: HASH_E,
    channelRef: UUID_F,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 20_000).toISOString(),
  };
}

function evidence() {
  return {
    artifactDigest: HASH_E,
    runtimeImageDigest: `sha256:${HASH_F}`,
    launcherDigest: HASH_A,
    filesystemPolicyDigest: HASH_B,
    networkPolicyDigest: HASH_C,
    resourcePolicyDigest: HASH_D,
    isolationEvidenceDigest: HASH_B,
    channelRef: UUID_F,
  };
}

function startAck(
  changes: Partial<PreviewRunnerStartAckV1> = {},
): PreviewRunnerStartAckV1 {
  return {
    ...commonFields(),
    messageType: "start_ack",
    status: "accepted",
    executionRef: "exec_abcdefghijklmnop",
    appliedEvidence: evidence(),
    ...changes,
  };
}

function readyObservation(
  changes: Partial<PreviewRunnerObservationV1> = {},
): PreviewRunnerObservationV1 {
  return {
    ...commonFields(),
    messageType: "observation",
    executionRef: "exec_abcdefghijklmnop",
    state: "ready",
    observedAt: NOW.toISOString(),
    evidence: evidence(),
    terminationConfirmed: false,
    channelClosed: false,
    cleanupConfirmed: false,
    failureCode: null,
    ...changes,
  };
}

function stopAck(
  changes: Partial<PreviewRunnerStopAckV1> = {},
): PreviewRunnerStopAckV1 {
  return {
    ...commonFields(),
    messageType: "stop_ack",
    status: "stopped",
    executionRef: "exec_abcdefghijklmnop",
    terminationConfirmed: true,
    channelClosed: true,
    cleanupConfirmed: true,
    ...changes,
  };
}

function expectedBinding(
  action: "start" | "observe" | "stop" = "start",
): ExpectedPreviewRunnerMessageBindingV1 {
  return {
    action,
    commandId: UUID_B,
    idempotencyKey: UUID_C,
    channelRef: UUID_F,
    nodeId: "runner-linux-01",
    keyId: "node-key-v1",
    sessionId: UUID_D,
    stateVersion: 1,
    executionGeneration: 2,
    fencingGeneration: 3,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 4,
    baseRevision: HASH_A,
    candidateRevision: HASH_B,
    changeSetHash: HASH_C,
    buildReceiptId: UUID_E,
    artifactDigest: HASH_E,
    runtimeProfileDigest: HASH_D,
    runtimeImageDigest: `sha256:${HASH_F}`,
    launcherDigest: HASH_A,
    filesystemPolicyDigest: HASH_B,
    networkPolicyDigest: HASH_C,
    resourcePolicyDigest: HASH_D,
  };
}

function signMessage(message: unknown): string {
  return signPreviewRunnerMessageV1({
    message,
    privateKeyPem,
    now: NOW,
  });
}

describe("signed Preview Runner results", () => {
  it("accepts a start acknowledgement but does not turn it into ready", () => {
    const verified = verifyPreviewRunnerMessageV1({
      token: signMessage(startAck()),
      publicKeyPem,
      expected: expectedBinding(),
      now: NOW,
    });

    expect(verified.messageType).toBe("start_ack");
    expect(isVerifiedPreviewRunnerMessageV1(verified)).toBe(true);
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it("requires exact evidence before accepting a ready observation", () => {
    const verified = verifyPreviewRunnerMessageV1({
      token: signMessage(readyObservation()),
      publicKeyPem,
      expected: expectedBinding("observe"),
      now: NOW,
    });

    expect(verified).toMatchObject({
      messageType: "observation",
      state: "ready",
      evidence: {
        artifactDigest: HASH_E,
        channelRef: UUID_F,
      },
    });
  });

  it("rejects ready with mismatched artifact evidence", () => {
    const invalid = readyObservation({
      evidence: { ...evidence(), artifactDigest: HASH_F },
    });
    expect(() => signMessage(invalid)).toThrowError(
      PreviewRunnerMessageError,
    );
  });

  it("rejects a signed report that applied a different runtime policy", () => {
    const altered = readyObservation({
      evidence: {
        ...evidence(),
        networkPolicyDigest: HASH_F,
      },
    });
    expect(() =>
      verifyPreviewRunnerMessageV1({
        token: signMessage(altered),
        publicKeyPem,
        expected: expectedBinding("observe"),
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_MESSAGE_BINDING_MISMATCH",
      }),
    );
  });

  it("rejects stopped until termination, channel closure, and cleanup are confirmed", () => {
    const invalid = stopAck({ cleanupConfirmed: false });
    expect(() => signMessage(invalid)).toThrowError(
      PreviewRunnerMessageError,
    );
    expect(() =>
      signMessage(stopAck({ status: "outcome_unknown" })),
    ).toThrowError(PreviewRunnerMessageError);
  });

  it("rejects stale observations even when their signature is valid", () => {
    const staleAt = new Date(NOW.getTime() - 6_000);
    const stale = readyObservation({
      issuedAt: new Date(NOW.getTime() - 1_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 10_000).toISOString(),
      observedAt: staleAt.toISOString(),
    });
    expect(() =>
      verifyPreviewRunnerMessageV1({
        token: signMessage(stale),
        publicKeyPem,
        expected: expectedBinding("observe"),
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "RUNNER_MESSAGE_STALE" }),
    );
  });

  it("rejects wrong node keys and changed session or fencing identities", () => {
    const token = signMessage(startAck());
    expect(() =>
      verifyPreviewRunnerMessageV1({
        token,
        publicKeyPem: otherPublicKeyPem,
        expected: expectedBinding(),
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_MESSAGE_SIGNATURE_INVALID",
      }),
    );
    expect(() =>
      verifyPreviewRunnerMessageV1({
        token,
        publicKeyPem,
        expected: { ...expectedBinding(), fencingGeneration: 4 },
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_MESSAGE_BINDING_MISMATCH",
      }),
    );
    expect(() =>
      verifyPreviewRunnerMessageV1({
        token,
        publicKeyPem,
        expected: expectedBinding("observe"),
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_MESSAGE_BINDING_MISMATCH",
      }),
    );
  });

  it("rejects unknown start outcomes that claim an execution", () => {
    const invalid = startAck({
      status: "outcome_unknown",
      executionRef: "exec_abcdefghijklmnop",
      appliedEvidence: evidence(),
    });
    expect(() => signMessage(invalid)).toThrowError(
      PreviewRunnerMessageError,
    );
  });
});
