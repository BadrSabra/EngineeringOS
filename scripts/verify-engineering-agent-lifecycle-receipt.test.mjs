import assert from "node:assert/strict";
import test from "node:test";
import { validateReceipt } from "./verify-engineering-agent-lifecycle-receipt.mjs";

function validReceipt() {
  return {
    schemaVersion: 1,
    status: "passed",
    stage: "complete",
    chain: {
      projectId: "project_1",
      sessionId: "session_1",
      userMessageId: "message_1",
      userMessageHash: "a".repeat(64),
      handoffPlanHash: "b".repeat(64),
      sourceMissionId: "mission_source",
      sourceGoalId: "goal_source",
      sourceExecutionId: "execution_source",
      sourceAttempt: 1,
      acceptanceId: "acceptance_source",
      proposalId: "proposal_1",
      proposalRevision: 2,
      candidateTreeHash: "c".repeat(64),
      applyMissionId: "mission_apply",
      applyGoalId: "goal_apply",
      applyExecutionId: "execution_apply",
      commitHash: "d".repeat(40),
      remoteCommitHash: "d".repeat(40),
      branch: "main",
      finalMissionId: "mission_apply",
      engineeringAgentState: "COMPLETE",
      activeMissionIdAfterReload: "mission_source",
    },
  };
}

test("accepts only a complete correlated lifecycle receipt", () => {
  const receipt = validReceipt();
  assert.equal(validateReceipt(receipt), receipt);
});

test("rejects extra, missing, and inconsistent receipt fields", () => {
  const withExtraKey = validReceipt();
  withExtraKey.chain.unverified = true;
  assert.throws(() => validateReceipt(withExtraKey), /chain_has_unexpected_key/);

  const missingCandidateIdentity = validReceipt();
  delete missingCandidateIdentity.chain.candidateTreeHash;
  assert.throws(() => validateReceipt(missingCandidateIdentity), /chain_candidateTreeHash/);

  const mismatchedFinalMission = validReceipt();
  mismatchedFinalMission.chain.finalMissionId = "another_mission";
  assert.throws(() => validateReceipt(mismatchedFinalMission), /final_mission_id_must_match_apply_mission/);
});

test("does not accept blocked journey receipts as successful completion", () => {
  const blocked = {
    schemaVersion: 1,
    status: "blocked",
    stage: "candidate-execution",
    code: "CANDIDATE_EXECUTION_BLOCKED",
  };
  assert.throws(() => validateReceipt(blocked), /receipt_not_passed/);
});
