import { generateKeyPairSync } from "node:crypto";
import {
  PreviewRunnerCapabilityError,
  signPreviewRunnerCapabilityV1,
} from "@workspace/preview-runner-contract";
import { describe, expect, it } from "vitest";
import {
  previewAgentPublicKeyFingerprint,
} from "./preview-agent-pairing-crypto.js";
import {
  acceptPreviewAgentCapabilityReport,
  PreviewAgentCapabilityError,
  verifyPreviewAgentCapabilityReport,
} from "./preview-agent-capability.js";
import type { PreviewRunnerQualificationRecordV1 } from "./preview-runner-qualification.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const NODE_ID = "11111111-1111-4111-8111-111111111111";
const QUALIFICATION_ID = "22222222-2222-4222-8222-222222222222";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const keys = generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKeyPem = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const fingerprint = previewAgentPublicKeyFingerprint(publicKeyPem);

const node = {
  nodeId: NODE_ID,
  status: "active" as const,
  publicKeyPem,
  publicKeyFingerprint: fingerprint,
  agentVersion: "1.2.3",
};

const qualification: PreviewRunnerQualificationRecordV1 = {
  qualificationRecordId: QUALIFICATION_ID,
  agentVersion: "1.2.3",
  sandboxProviderId: "gvisor",
  sandboxRuntimeVersion: "1.0.0",
  isolationClass: "syscall_sandbox",
  runtimeProfileDigest: HASH_A,
  sandboxPolicyDigest: HASH_B,
  evidenceMode: "local_observed",
};

function signedReport(changes: Record<string, unknown> = {}) {
  return signPreviewRunnerCapabilityV1({
    capability: {
      protocolVersion: 1,
      nodeId: NODE_ID,
      agentVersion: "1.2.3",
      sandboxProviderId: "gvisor",
      sandboxRuntimeVersion: "1.0.0",
      isolationClass: "syscall_sandbox",
      runtimeProfileDigest: HASH_A,
      sandboxPolicyDigest: HASH_B,
      qualificationRecordId: QUALIFICATION_ID,
      observedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 20_000).toISOString(),
      evidenceMode: "local_observed",
      evidenceKeyId: fingerprint,
      ...changes,
    },
    privateKeyPem,
    now: NOW,
  });
}

describe("Preview Agent capability qualification", () => {
  it("keeps API admission unsupported until a server record is approved", async () => {
    await expect(
      acceptPreviewAgentCapabilityReport({
        nodeId: NODE_ID,
        qualificationRecordId: QUALIFICATION_ID,
        token: "signed-report",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_CAPABILITY_UNQUALIFIED",
    });
  });

  it("accepts only a fresh report bound to the active node key and server record", () => {
    const verified = verifyPreviewAgentCapabilityReport({
      node,
      qualification,
      token: signedReport(),
      now: NOW,
    });

    expect(verified.nodeId).toBe(NODE_ID);
    expect(verified.qualificationRecordId).toBe(QUALIFICATION_ID);
  });

  it("rejects a revoked Agent before its signed report can be used", () => {
    expect(() =>
      verifyPreviewAgentCapabilityReport({
        node: { ...node, status: "revoked" },
        qualification,
        token: signedReport(),
        now: NOW,
      }),
    ).toThrowError(PreviewAgentCapabilityError);
  });

  it("rejects a token whose key fingerprint differs from the registered key", () => {
    expect(() =>
      verifyPreviewAgentCapabilityReport({
        node,
        qualification,
        token: signedReport({ evidenceKeyId: "c".repeat(64) }),
        now: NOW,
      }),
    ).toThrowError(PreviewAgentCapabilityError);
  });

  it("rejects a report if the paired Agent version differs from qualification", () => {
    expect(() =>
      verifyPreviewAgentCapabilityReport({
        node: { ...node, agentVersion: "1.2.2" },
        qualification,
        token: signedReport(),
        now: NOW,
      }),
    ).toThrowError(PreviewAgentCapabilityError);
  });

  it("rejects key-record tampering and outdated capability reports", () => {
    expect(() =>
      verifyPreviewAgentCapabilityReport({
        node: { ...node, publicKeyFingerprint: "d".repeat(64) },
        qualification,
        token: signedReport(),
        now: NOW,
      }),
    ).toThrowError(PreviewAgentCapabilityError);

    expect(() =>
      verifyPreviewAgentCapabilityReport({
        node,
        qualification,
        token: signedReport(),
        now: new Date(NOW.getTime() + 5_001),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_AGENT_CAPABILITY_INVALID",
      }),
    );
  });

  it("rejects reports for a different server-owned runtime policy", () => {
    const alteredQualification = {
      ...qualification,
      sandboxPolicyDigest: "e".repeat(64),
    };

    expect(() =>
      verifyPreviewAgentCapabilityReport({
        node,
        qualification: alteredQualification,
        token: signedReport(),
        now: NOW,
      }),
    ).toThrowError(PreviewAgentCapabilityError);
  });

  it("does not expose low-level signature errors to callers", () => {
    let thrown: unknown;
    try {
      verifyPreviewAgentCapabilityReport({
        node,
        qualification,
        token: "not-a-signed-report",
        now: NOW,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreviewAgentCapabilityError);
    expect(thrown).not.toBeInstanceOf(PreviewRunnerCapabilityError);
  });
});
