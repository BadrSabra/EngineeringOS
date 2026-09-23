import { describe, expect, it } from "vitest";
import { buildExecutionProofProjection } from "./execution-proof.js";
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
    candidateIdentity: "candidate-tree",
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
    expect(validateSkillCandidateForShadow(value, {
      projectId: "project",
      sourceRevision: "revision",
      candidateTreeHash: "a".repeat(64),
    })).toMatchObject({ allowed: true });

    expect(buildShadowReplayReceipt(value)).toMatchObject({
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
    expect(validateSkillCandidateForShadow(incomplete)).toMatchObject({
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
    expect(validateSkillCandidateForShadow(production)).toMatchObject({
      allowed: false,
      reasons: ["invalid_skill_candidate_envelope"],
    });
  });
});