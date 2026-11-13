import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signPreviewRunnerCapabilityV1,
  verifyPreviewRunnerCapabilityV1,
  type PreviewRunnerCapabilityV1,
} from "@workspace/preview-runner-contract";
import {
  createPreviewRunnerQualificationRegistry,
  previewRunnerQualificationRegistry,
  type PreviewRunnerQualificationRecordV1,
} from "./preview-runner-qualification.js";
import {
  evaluatePreviewPlacement,
  isPreviewPlacementDecisionCurrent,
  PREVIEW_PLACEMENT_POLICY_VERSION,
  type PreviewPlacementCandidate,
  type PreviewPlacementRunnerSnapshot,
  type PreviewPlacementRequirements,
} from "./preview-placement-policy.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const QUALIFICATION_ID = "11111111-1111-4111-8111-111111111111";
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKeyPem = keyPair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const qualification: PreviewRunnerQualificationRecordV1 = {
  qualificationRecordId: QUALIFICATION_ID,
  agentVersion: "0.1.0",
  sandboxProviderId: "gvisor",
  sandboxRuntimeVersion: "1.0.0",
  isolationClass: "syscall_sandbox",
  runtimeProfileDigest: HASH_A,
  sandboxPolicyDigest: HASH_B,
  evidenceMode: "local_observed",
};
const qualificationRegistry =
  createPreviewRunnerQualificationRegistry([qualification]);

const candidate: PreviewPlacementCandidate = {
  projectId: "project-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 4,
  candidateRevision: HASH_C,
  changeSetHash: HASH_B,
  status: "pending",
  lifecycle: "isolated",
};

const requirements: PreviewPlacementRequirements = {
  runtimeProfileDigest: HASH_A,
  sandboxPolicyDigest: HASH_B,
  requiredIsolationClass: "syscall_sandbox",
  requiredEvidenceMode: "local_observed",
};

function capability(
  changes: Partial<PreviewRunnerCapabilityV1> = {},
): PreviewRunnerCapabilityV1 {
  return {
    protocolVersion: 1,
    nodeId: "runner-local-01",
    agentVersion: qualification.agentVersion,
    sandboxProviderId: qualification.sandboxProviderId,
    sandboxRuntimeVersion: qualification.sandboxRuntimeVersion,
    isolationClass: qualification.isolationClass,
    runtimeProfileDigest: qualification.runtimeProfileDigest,
    sandboxPolicyDigest: qualification.sandboxPolicyDigest,
    qualificationRecordId: qualification.qualificationRecordId,
    observedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 20_000).toISOString(),
    evidenceMode: qualification.evidenceMode,
    evidenceKeyId: "node-key-v1",
    ...changes,
  };
}

function makeRunner(
  nodeId = "runner-local-01",
  changes: Partial<PreviewPlacementRunnerSnapshot> = {},
): PreviewPlacementRunnerSnapshot {
  const report = capability({ nodeId });
  const token = signPreviewRunnerCapabilityV1({
    capability: report,
    privateKeyPem,
    now: NOW,
  });
  const verified = verifyPreviewRunnerCapabilityV1({
    token,
    publicKeyPem,
    expected: {
      nodeId,
      agentVersion: report.agentVersion,
      sandboxProviderId: report.sandboxProviderId,
      sandboxRuntimeVersion: report.sandboxRuntimeVersion,
      isolationClass: report.isolationClass,
      runtimeProfileDigest: report.runtimeProfileDigest,
      sandboxPolicyDigest: report.sandboxPolicyDigest,
      qualificationRecordId: report.qualificationRecordId,
      evidenceMode: report.evidenceMode,
      evidenceKeyId: report.evidenceKeyId,
    },
    now: NOW,
  });

  return {
    nodeId,
    projectId: candidate.projectId,
    status: "active",
    lastSeenAt: NOW,
    capabilityExpiresAt: new Date(report.expiresAt),
    capability: verified,
    ...changes,
  };
}

function evaluate(
  changes: Partial<Parameters<typeof evaluatePreviewPlacement>[0]> = {},
) {
  return evaluatePreviewPlacement({
    mode: "local_preferred",
    requestedCandidate: candidate,
    currentCandidate: candidate,
    requirements,
    localRunners: [],
    now: NOW,
    freshnessWindowMs: 30_000,
    cloud: {
      configured: false,
      userApproved: false,
      costPolicyAllows: false,
    },
    qualificationFor: qualificationRegistry.get,
    ...changes,
  });
}

describe("server-owned Preview placement policy", () => {
  it("chooses an eligible local Runner deterministically and binds the Candidate", () => {
    const result = evaluate({
      localRunners: [makeRunner("runner-z"), makeRunner("runner-a")],
      cloud: {
        configured: true,
        userApproved: true,
        costPolicyAllows: true,
      },
    });

    expect(result).toMatchObject({
      policyVersion: PREVIEW_PLACEMENT_POLICY_VERSION,
      outcome: "selected",
      provider: "local",
      nodeId: "runner-a",
      candidate: {
        projectId: candidate.projectId,
        proposalId: candidate.proposalId,
        operationId: candidate.operationId,
        proposalRevision: candidate.proposalRevision,
        candidateRevision: HASH_C,
        changeSetHash: HASH_B,
      },
      executionAuthorized: false,
    });
  });

  it("blocks a stale or no-longer-eligible Candidate before provider selection", () => {
    const stale = { ...candidate, candidateRevision: HASH_A };
    expect(
      evaluate({
        requestedCandidate: candidate,
        currentCandidate: stale,
        localRunners: [makeRunner()],
        mode: "cloud_allowed",
        cloud: {
          configured: true,
          userApproved: true,
          costPolicyAllows: true,
        },
      }),
    ).toMatchObject({
      outcome: "blocked",
      provider: null,
      reason: "candidate_not_current",
    });

    expect(
      evaluate({
        requestedCandidate: { ...candidate, lifecycle: "draft" },
        localRunners: [makeRunner()],
      }),
    ).toMatchObject({
      outcome: "blocked",
      provider: null,
      reason: "candidate_not_current",
    });
  });

  it("does not treat a signed capability as qualified without the server registry", () => {
    expect(
      evaluate({
        localRunners: [makeRunner()],
        qualificationFor: () => undefined,
      }),
    ).toMatchObject({
      outcome: "waiting",
      provider: null,
      reason: "local_runner_unavailable",
    });
  });

  it("keeps the production qualification registry fail-closed while empty", () => {
    expect(previewRunnerQualificationRegistry.list()).toEqual([]);
    expect(
      evaluate({
        localRunners: [makeRunner()],
        qualificationFor: previewRunnerQualificationRegistry.get,
      }),
    ).toMatchObject({
      outcome: "waiting",
      provider: null,
      reason: "local_runner_unavailable",
      executionAuthorized: false,
    });
  });

  it("rejects revoked, cross-project, stale, expired, and unverified Runner snapshots", () => {
    const valid = makeRunner();
    const unverified = capability() as unknown as NonNullable<
      PreviewPlacementRunnerSnapshot["capability"]
    >;
    const invalidSnapshots: PreviewPlacementRunnerSnapshot[] = [
      { ...valid, status: "revoked" },
      { ...valid, projectId: "another-project" },
      {
        ...valid,
        lastSeenAt: new Date(NOW.getTime() - 30_001),
      },
      {
        ...valid,
        capabilityExpiresAt: new Date(NOW.getTime() - 1),
      },
      {
        ...valid,
        capability: unverified,
      },
    ];

    for (const runner of invalidSnapshots) {
      expect(
        evaluate({
          localRunners: [runner],
        }),
      ).toMatchObject({
        outcome: "waiting",
        provider: null,
        reason: "local_runner_unavailable",
      });
    }
  });

  it("requires exact server-qualified profile, isolation, sandbox, and assurance", () => {
    const mismatchedQualification = createPreviewRunnerQualificationRegistry([
      {
        ...qualification,
        runtimeProfileDigest: HASH_C,
      },
    ]);
    expect(
      evaluate({
        localRunners: [makeRunner()],
        qualificationFor: mismatchedQualification.get,
      }),
    ).toMatchObject({
      outcome: "waiting",
      provider: null,
      reason: "local_runner_unavailable",
    });

    expect(
      evaluate({
        requirements: {
          ...requirements,
          requiredIsolationClass: "microvm",
        },
        localRunners: [makeRunner()],
      }),
    ).toMatchObject({
      outcome: "waiting",
      provider: null,
      reason: "local_runner_unavailable",
    });
  });

  it("keeps local-only and local-preferred policies from silently falling back to cloud", () => {
    const cloudReady = {
      configured: true,
      userApproved: true,
      costPolicyAllows: true,
    };
    expect(
      evaluate({
        mode: "local_only",
        cloud: cloudReady,
      }),
    ).toMatchObject({
      outcome: "blocked",
      provider: null,
      reason: "local_runner_unavailable",
    });
    expect(
      evaluate({
        mode: "local_preferred",
        cloud: cloudReady,
      }),
    ).toMatchObject({
      outcome: "waiting",
      provider: null,
      reason: "local_runner_unavailable",
    });
  });

  it("requires configured cloud, explicit approval, and an allowed cost policy", () => {
    expect(
      evaluate({
        mode: "cloud_allowed",
        cloud: {
          configured: false,
          userApproved: true,
          costPolicyAllows: true,
        },
      }),
    ).toMatchObject({
      outcome: "waiting",
      reason: "cloud_not_configured",
    });
    expect(
      evaluate({
        mode: "cloud_allowed",
        cloud: {
          configured: true,
          userApproved: false,
          costPolicyAllows: true,
        },
      }),
    ).toMatchObject({
      outcome: "blocked",
      reason: "cloud_approval_required",
    });
    expect(
      evaluate({
        mode: "cloud_allowed",
        cloud: {
          configured: true,
          userApproved: true,
          costPolicyAllows: false,
        },
      }),
    ).toMatchObject({
      outcome: "blocked",
      reason: "cloud_cost_policy_rejected",
    });
    expect(
      evaluate({
        mode: "cloud_allowed",
        cloud: {
          configured: true,
          userApproved: true,
          costPolicyAllows: true,
        },
      }),
    ).toMatchObject({
      outcome: "selected",
      provider: "cloud",
      executionAuthorized: false,
    });
  });

  it("invalidates a selected decision when the Candidate revision changes", () => {
    const decision = evaluate({ localRunners: [makeRunner()] });
    expect(
      isPreviewPlacementDecisionCurrent({
        decision,
        currentCandidate: candidate,
      }),
    ).toBe(true);
    expect(
      isPreviewPlacementDecisionCurrent({
        decision,
        currentCandidate: { ...candidate, proposalRevision: 5 },
      }),
    ).toBe(false);
  });

  it("rejects malformed policy inputs instead of producing a placement", () => {
    expect(() =>
      evaluate({
        freshnessWindowMs: 0,
      }),
    ).toThrowError("Preview placement policy input is invalid.");
    expect(() =>
      evaluate({
        requestedCandidate: {
          ...candidate,
          candidateRevision: "not-a-digest",
        },
      }),
    ).toThrowError("Preview placement policy input is invalid.");
    expect(() =>
      evaluate({
        mode: "unrecognized" as "local_only",
      }),
    ).toThrowError("Preview placement policy input is invalid.");
  });
});
