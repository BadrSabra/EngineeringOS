import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreviewRunnerCapabilityError,
  isVerifiedPreviewRunnerCapabilityV1,
  signPreviewRunnerCapabilityV1,
  verifyPreviewRunnerCapabilityV1,
  type ExpectedPreviewRunnerCapabilityBindingV1,
  type PreviewRunnerCapabilityV1,
} from "./runner-capability.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const QUALIFICATION_ID = "11111111-1111-4111-8111-111111111111";

const keys = generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKeyPem = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const otherKeys = generateKeyPairSync("ed25519");
const otherPublicKeyPem = otherKeys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function capability(
  changes: Partial<PreviewRunnerCapabilityV1> = {},
): PreviewRunnerCapabilityV1 {
  return {
    protocolVersion: 1,
    nodeId: "runner-local-01",
    agentVersion: "0.1.0",
    sandboxProviderId: "gvisor",
    sandboxRuntimeVersion: "1.0.0",
    isolationClass: "syscall_sandbox",
    runtimeProfileDigest: HASH_A,
    sandboxPolicyDigest: HASH_B,
    qualificationRecordId: QUALIFICATION_ID,
    observedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 20_000).toISOString(),
    evidenceMode: "local_observed",
    evidenceKeyId: "node-key-v1",
    ...changes,
  };
}

function expected(
  changes: Partial<ExpectedPreviewRunnerCapabilityBindingV1> = {},
): ExpectedPreviewRunnerCapabilityBindingV1 {
  return {
    nodeId: "runner-local-01",
    agentVersion: "0.1.0",
    sandboxProviderId: "gvisor",
    sandboxRuntimeVersion: "1.0.0",
    isolationClass: "syscall_sandbox",
    runtimeProfileDigest: HASH_A,
    sandboxPolicyDigest: HASH_B,
    qualificationRecordId: QUALIFICATION_ID,
    evidenceMode: "local_observed",
    evidenceKeyId: "node-key-v1",
    ...changes,
  };
}

function signCapability(value: unknown): string {
  return signPreviewRunnerCapabilityV1({
    capability: value,
    privateKeyPem,
    now: NOW,
  });
}

function verifyCapability(
  token: string,
  binding: ExpectedPreviewRunnerCapabilityBindingV1 = expected(),
) {
  return verifyPreviewRunnerCapabilityV1({
    token,
    publicKeyPem,
    expected: binding,
    now: NOW,
  });
}

describe("signed Preview Runner capability snapshots", () => {
  it("verifies a fresh report against the API-owned qualification binding", () => {
    const verified = verifyCapability(signCapability(capability()));

    expect(verified.isolationClass).toBe("syscall_sandbox");
    expect(isVerifiedPreviewRunnerCapabilityV1(verified)).toBe(true);
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it("rejects shared-kernel evidence even when the node signs it", () => {
    const token = signCapability(
      capability({ isolationClass: "shared_kernel" }),
    );

    expect(() => verifyCapability(token)).toThrowError(
      expect.objectContaining({
        code: "RUNNER_CAPABILITY_BINDING_MISMATCH",
      }),
    );
  });

  it("rejects a report that names a different qualification record", () => {
    const token = signCapability(
      capability({
        qualificationRecordId: "22222222-2222-4222-8222-222222222222",
      }),
    );

    expect(() => verifyCapability(token)).toThrowError(
      PreviewRunnerCapabilityError,
    );
  });

  it("rejects stale observations and expired reports", () => {
    const token = signCapability(capability());
    expect(() =>
      verifyPreviewRunnerCapabilityV1({
        token,
        publicKeyPem,
        expected: expected(),
        now: new Date(NOW.getTime() + 5_001),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "RUNNER_CAPABILITY_STALE" }),
    );

    const expiresSoon = signCapability(
      capability({
        expiresAt: new Date(NOW.getTime() + 1_000).toISOString(),
      }),
    );
    expect(() =>
      verifyPreviewRunnerCapabilityV1({
        token: expiresSoon,
        publicKeyPem,
        expected: expected(),
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "RUNNER_CAPABILITY_EXPIRED" }),
    );
  });

  it("rejects a valid token signed by a key other than the registered node key", () => {
    const token = signCapability(capability());

    expect(() =>
      verifyPreviewRunnerCapabilityV1({
        token,
        publicKeyPem: otherPublicKeyPem,
        expected: expected(),
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_CAPABILITY_SIGNATURE_INVALID",
      }),
    );
  });

  it("rejects profile, runtime, policy, node, or evidence-mode drift", () => {
    const token = signCapability(capability());
    for (const binding of [
      expected({ nodeId: "other-node" }),
      expected({ runtimeProfileDigest: HASH_B }),
      expected({ sandboxPolicyDigest: HASH_A }),
      expected({ sandboxRuntimeVersion: "1.0.1" }),
      expected({ evidenceMode: "remote_attested" }),
      expected({ evidenceKeyId: "revoked-key" }),
    ]) {
      expect(() => verifyCapability(token, binding)).toThrowError(
        PreviewRunnerCapabilityError,
      );
    }
  });

  it("rejects unknown fields and non-canonical token framing", () => {
    expect(() =>
      signCapability({ ...capability(), dockerSocket: true }),
    ).toThrowError(PreviewRunnerCapabilityError);

    const token = signCapability(capability());
    expect(() => verifyCapability(`${token}.extra`)).toThrowError(
      PreviewRunnerCapabilityError,
    );
  });
});
