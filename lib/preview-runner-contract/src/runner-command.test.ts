import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreviewRunnerCommandError,
  isVerifiedPreviewRunnerCommandV1,
  previewRuntimeProfileDigest,
  signPreviewRunnerCommandV1,
  verifyPreviewRunnerCommandV1,
  type PreviewRunnerCommandBindingV1,
  type PreviewRunnerStartCommandV1,
  type PreviewRunnerStopCommandV1,
  type PreviewRuntimeProfileV1,
} from "./runner-command.js";

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
const UUID_G = "77777777-7777-4777-8777-777777777777";

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

function profile(
  changes: Partial<PreviewRuntimeProfileV1> = {},
): PreviewRuntimeProfileV1 {
  return {
    profileId: "node-express-managed-v1",
    version: 1,
    runtimeImageDigest: `sha256:${HASH_A}`,
    launcherDigest: HASH_B,
    requiredIsolationClass: "syscall_sandbox",
    filesystemPolicyDigest: HASH_C,
    networkPolicyDigest: HASH_D,
    resourcePolicyDigest: HASH_E,
    exposureProtocol: "session_uds_v1",
    qualificationRecordId: UUID_G,
    ...changes,
  };
}

function startCommand(
  changes: Partial<PreviewRunnerStartCommandV1> = {},
  now = NOW,
): PreviewRunnerStartCommandV1 {
  const runtimeProfile = profile();
  return {
    protocolVersion: 1,
    action: "start",
    commandId: UUID_A,
    idempotencyKey: UUID_B,
    nodeId: "runner-linux-01",
    sessionId: UUID_C,
    stateVersion: 0,
    executionGeneration: 1,
    fencingGeneration: 1,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 2,
    baseRevision: HASH_F,
    candidateRevision: HASH_A,
    changeSetHash: HASH_B,
    buildReceiptId: UUID_D,
    runtimeProfileDigest: previewRuntimeProfileDigest(runtimeProfile),
    channelRef: UUID_E,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    artifactRef: {
      artifactId: UUID_F,
      digest: HASH_C,
      manifestDigest: HASH_D,
      sizeBytes: 1024,
    },
    runtimeProfile,
    resourceLimits: {
      cpuMillicores: 1_000,
      memoryBytes: 512 * 1024 * 1024,
      scratchBytes: 128 * 1024 * 1024,
      pidLimit: 64,
      startupTimeoutMs: 30_000,
      idleTimeoutMs: 5 * 60_000,
      sessionTtlMs: 15 * 60_000,
    },
    ...changes,
  };
}

function stopCommand(
  changes: Partial<PreviewRunnerStopCommandV1> = {},
): PreviewRunnerStopCommandV1 {
  return {
    protocolVersion: 1,
    action: "stop",
    commandId: UUID_A,
    idempotencyKey: UUID_B,
    nodeId: "runner-linux-01",
    sessionId: UUID_C,
    stateVersion: 3,
    executionGeneration: 1,
    fencingGeneration: 2,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 2,
    baseRevision: HASH_F,
    candidateRevision: HASH_A,
    changeSetHash: HASH_B,
    buildReceiptId: UUID_D,
    runtimeProfileDigest: HASH_E,
    channelRef: UUID_E,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 20_000).toISOString(),
    executionRef: "exec_abcdefghijklmnop",
    reason: "owner_stopped",
    ...changes,
  };
}

function binding(
  command: PreviewRunnerStartCommandV1 | PreviewRunnerStopCommandV1,
): PreviewRunnerCommandBindingV1 {
  return {
    nodeId: command.nodeId,
    sessionId: command.sessionId,
    stateVersion: command.stateVersion,
    executionGeneration: command.executionGeneration,
    fencingGeneration: command.fencingGeneration,
    projectId: command.projectId,
    proposalId: command.proposalId,
    operationId: command.operationId,
    proposalRevision: command.proposalRevision,
    baseRevision: command.baseRevision,
    candidateRevision: command.candidateRevision,
    changeSetHash: command.changeSetHash,
    buildReceiptId: command.buildReceiptId,
    runtimeProfileDigest: command.runtimeProfileDigest,
  };
}

function sign(command: unknown): string {
  return signPreviewRunnerCommandV1({
    command,
    privateKeyPem,
    now: NOW,
  });
}

describe("provider-neutral Preview Runner command contract", () => {
  it("signs and verifies a strictly bound start command", () => {
    const command = startCommand();
    const verified = verifyPreviewRunnerCommandV1({
      token: sign(command),
      publicKeyPem,
      expected: binding(command),
      now: NOW,
    });

    expect(verified).toMatchObject({
      action: "start",
      sessionId: UUID_C,
      projectId: "project-1",
      candidateRevision: HASH_A,
      changeSetHash: HASH_B,
    });
    if (verified.action !== "start") {
      throw new Error("Expected a verified start command.");
    }
    expect(isVerifiedPreviewRunnerCommandV1(verified)).toBe(true);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.artifactRef)).toBe(true);
  });

  it("signs a stop against the exact execution and fencing generation", () => {
    const command = stopCommand();
    const verified = verifyPreviewRunnerCommandV1({
      token: sign(command),
      publicKeyPem,
      expected: binding(command),
      now: NOW,
    });

    expect(verified).toMatchObject({
      action: "stop",
      executionRef: "exec_abcdefghijklmnop",
      fencingGeneration: 2,
      reason: "owner_stopped",
    });
  });

  it("rejects standard shared-kernel isolation profiles", () => {
    const unsafeProfile = profile({
      requiredIsolationClass:
        "shared_kernel" as PreviewRuntimeProfileV1["requiredIsolationClass"],
    });
    const command = startCommand({
      runtimeProfile: unsafeProfile,
      runtimeProfileDigest: previewRuntimeProfileDigest(profile()),
    });

    expect(() => sign(command)).toThrowError(PreviewRunnerCommandError);
  });

  it("rejects extra command fields and arbitrary paths or commands", () => {
    const command = startCommand();
    const tampered = {
      ...command,
      shellCommand: "pnpm run dev",
      hostPath: "/home/runner/workspace",
    };

    expect(() => sign(tampered)).toThrowError(
      expect.objectContaining({ code: "RUNNER_COMMAND_INVALID" }),
    );
  });

  it("rejects command expiry, future issue time, and overlong command TTL", () => {
    const expired = startCommand({}, new Date(NOW.getTime() - 40_000));
    expect(() => sign(expired)).toThrowError(
      expect.objectContaining({ code: "RUNNER_COMMAND_EXPIRED" }),
    );

    const tooLong = startCommand({
      expiresAt: new Date(NOW.getTime() + 30_001).toISOString(),
    });
    expect(() => sign(tooLong)).toThrowError(
      expect.objectContaining({ code: "RUNNER_COMMAND_EXPIRED" }),
    );

    const future = startCommand({
      issuedAt: new Date(NOW.getTime() + 6_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 20_000).toISOString(),
    });
    expect(() => sign(future)).toThrowError(
      expect.objectContaining({ code: "RUNNER_COMMAND_EXPIRED" }),
    );
  });

  it("rejects an artifact/profile digest mismatch before signing", () => {
    const command = startCommand({
      runtimeProfile: profile({ version: 2 }),
    });
    expect(() => sign(command)).toThrowError(
      expect.objectContaining({ code: "RUNNER_PROFILE_DIGEST_MISMATCH" }),
    );
  });

  it("rejects tampering, a wrong signing key, or a changed durable binding", () => {
    const command = startCommand();
    const token = sign(command);
    const [payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...command, projectId: "project-2" }),
    ).toString("base64url");

    expect(() =>
      verifyPreviewRunnerCommandV1({
        token: `${tamperedPayload}.${signature}`,
        publicKeyPem,
        now: NOW,
      }),
    ).toThrowError(PreviewRunnerCommandError);
    expect(payload).toBeDefined();
    expect(() =>
      verifyPreviewRunnerCommandV1({
        token,
        publicKeyPem: otherPublicKeyPem,
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_COMMAND_SIGNATURE_INVALID",
      }),
    );

    const expected = binding(command);
    expect(() =>
      verifyPreviewRunnerCommandV1({
        token,
        publicKeyPem,
        expected: { ...expected, fencingGeneration: 9 },
        now: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_COMMAND_BINDING_MISMATCH",
      }),
    );
  });
});
