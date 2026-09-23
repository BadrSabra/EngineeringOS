import { describe, expect, it } from "vitest";
import { buildExecutionProofProjection } from "./execution-proof.js";
import { composeCanonicalProof } from "./proof-foundation.js";
import {
  buildShadowReplayReceipt,
  validateSkillCandidateForShadow,
} from "./skill-candidate.js";

function candidate(overrides: Record<string, unknown> = {}) {
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId: "receipt-evidence",
    sourceRevision: "revision",
    candidateIdentity: "a".repeat(64),
  });
  return {
    contractVersion: 1,
    candidateId: "skill:candidate-1",
    projectId: "project",
    sourceRevision: "revision",
    candidateTreeHash: "a".repeat(64),
    changeSetHash: null,
    approvedPaths: ["src/index.ts"],
    verification: { recipeId: "candidate.verify", recipeVersion: 1 },
    proof: {
      receiptId: "receipt-1",
      trajectoryDigest: proof.trajectoryDigest.digest,
      verdict: proof.verdict,
      projection: proof,
    },
    shadow: {
      mode: "shadow-replay",
      runId: "replay-1",
      isolated: true,
      productionExecution: false,
    },
    ...overrides,
  };
}

describe("skill candidate shadow contract", () => {
  it("accepts only a proven, bound candidate envelope", () => {
    const value = candidate();

    const canonicalProof = composeCanonicalProof({
      scope: {
        projectId: "project",
        executionId: "execution-1",
        sourceRevision: "revision",
        candidateIdentity: "a".repeat(64),
      },
      goalStatus: "completed",
      execution: {
        id: "execution-1",
        projectId: "project",
        attempt: 1,
        baseRevision: "revision",
      },
      acceptance: {
        id: "receipt-1",
        executionId: "execution-1",
        projectId: "project",
        attempt: 1,
        terminalStatus: "completed",
        outcome: "SUCCEEDED",
        evidenceSnapshotId: "receipt-evidence",
        evidenceRequired: true,
        evidenceComplete: true,
        sourceRevision: "revision",
        candidateIdentity: "a".repeat(64),
        disposition: { proof: value.proof.projection },
      },
      evidence: {
        id: "receipt-evidence",
        executionId: "execution-1",
        projectId: "project",
        attempt: 1,
        sourceRevision: "revision",
        candidateIdentity: "a".repeat(64),
        complete: true,
        verdict: "PROVEN",
      },
    });
    expect(validateSkillCandidateForShadow(value, canonicalProof, {
      projectId: "project",
      sourceRevision: "revision",
      candidateTreeHash: "a".repeat(64),
    })).toMatchObject({ allowed: true });
    expect(buildShadowReplayReceipt(value, canonicalProof, {
      projectId: "project",
      sourceRevision: "revision",
      candidateTreeHash: "a".repeat(64),
    })).toMatchObject({
      candidateId: "skill:candidate-1",
      candidateTreeHash: "a".repeat(64),
      productionExecution: false,
    });
  });

  it("rejects incomplete proof and any production execution flag", () => {
    const incomplete = candidate({
      proof: {
        ...candidate().proof as Record<string, unknown>,
        verdict: "INCOMPLETE",
      },
    });
    expect(validateSkillCandidateForShadow(incomplete, null)).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining(["skill_candidate_proof_not_proven"]),
    });

    const production = candidate({
      shadow: {
        mode: "shadow-replay",
        runId: "replay-1",
        isolated: true,
        productionExecution: true,
      },
    });
    expect(validateSkillCandidateForShadow(production, null)).toMatchObject({
      allowed: false,
      reasons: ["invalid_skill_candidate_envelope"],
    });
  });
});