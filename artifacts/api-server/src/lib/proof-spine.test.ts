import { describe, expect, it } from "vitest";
import { buildExecutionProofProjection } from "./execution-proof.js";
import { composeCanonicalProof } from "./proof-foundation.js";
import { projectProofSpine } from "./proof-spine.js";

function provenProof() {
  const projection = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId: "snapshot-1",
    sourceRevision: "revision-1",
    candidateIdentity: "candidate-1",
  });
  return composeCanonicalProof({
    goalStatus: "completed",
    scope: {
      projectId: "project-1",
      missionId: "mission-1",
      goalId: "goal-1",
      planRevision: "plan-1",
      activePlanRevision: "plan-1",
      sourceRevision: "revision-1",
      candidateIdentity: "candidate-1",
    },
    execution: {
      id: "execution-1",
      projectId: "project-1",
      goalId: "goal-1",
      operationId: "operation-1",
      attempt: 1,
      baseRevision: "revision-1",
    },
    acceptance: {
      id: "acceptance-1",
      executionId: "execution-1",
      projectId: "project-1",
      attempt: 1,
      operationId: "operation-1",
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      evidenceSnapshotId: "snapshot-1",
      evidenceRequired: true,
      evidenceComplete: true,
      sourceRevision: "revision-1",
      candidateIdentity: "candidate-1",
      disposition: { proof: projection },
    },
    evidence: {
      id: "snapshot-1",
      executionId: "execution-1",
      projectId: "project-1",
      attempt: 1,
      sourceRevision: "revision-1",
      candidateIdentity: "candidate-1",
      complete: true,
      verdict: "PROVEN",
    },
  });
}

describe("proof spine projection", () => {
  it("keeps proof, replay, and paired baseline references in one bounded projection", () => {
    const spine = projectProofSpine(provenProof(), {
      replay: {
        replayId: "replay-1",
        executionId: "replay-execution-1",
        status: "completed",
      },
      pairedBaseline: { status: "passed", promotionAllowed: true },
    });

    expect(spine).toMatchObject({
      contractVersion: 1,
      verdict: "PROVEN",
      accepted: true,
      identity: {
        projectId: "project-1",
        missionId: "mission-1",
        goalId: "goal-1",
        executionId: "execution-1",
        acceptanceId: "acceptance-1",
      },
      revision: { source: "revision-1", plan: "plan-1", activePlan: "plan-1" },
      evidence: { snapshotId: "snapshot-1", retained: true },
      candidate: { identity: "candidate-1" },
      replay: { replayId: "replay-1", status: "completed" },
      pairedBaseline: { status: "passed", promotionAllowed: true },
    });
    expect(JSON.stringify(spine)).not.toContain("source bodies");
  });
});