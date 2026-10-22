import assert from "node:assert/strict";
import test from "node:test";
import { validateReceipt } from "./verify-engineering-agent-lifecycle-receipt.mjs";

function validReceipt() {
  return {
    schemaVersion: 1,
    status: "passed",
    stage: "complete",
    sourceFingerprint: "e".repeat(64),
    chain: {
      projectId: "project_1",
      chatStream: {
        eventTypes: [
          "session_started",
          "stage",
          "execution_started",
          "intent",
          "behavior_progress",
          "delta",
          "recipe_terminal",
          "done",
        ],
        sessionStarted: true,
        sessionStartedSessionId: "session_1",
        doneHasSessionId: true,
        doneSessionId: "session_1",
        sessionIdsMatch: true,
        doneMessageId: "assistant_message_1",
        doneMessageRole: "assistant",
        doneMessageContentLength: 37,
        doneTurnIntent: "DELIVERY",
        doneTaskResultKind: "IMPLEMENTATION_PLAN_RESULT",
      },
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
      deliveryGoalId: "goal_delivery",
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
  assert.equal(validateReceipt(receipt, receipt.sourceFingerprint), receipt);
});

test("rejects a receipt produced from a different source tree", () => {
  assert.throws(
    () => validateReceipt(validReceipt(), "f".repeat(64)),
    /receipt_source_fingerprint_mismatch/,
  );
});

test("rejects extra, missing, and inconsistent receipt fields", () => {
  const withExtraKey = validReceipt();
  withExtraKey.chain.unverified = true;
  assert.throws(() => validateReceipt(withExtraKey), /chain_has_unexpected_key/);

  const missingCandidateIdentity = validReceipt();
  delete missingCandidateIdentity.chain.candidateTreeHash;
  assert.throws(() => validateReceipt(missingCandidateIdentity), /chain_candidateTreeHash/);

  const missingDeliveryGoal = validReceipt();
  delete missingDeliveryGoal.chain.deliveryGoalId;
  assert.throws(() => validateReceipt(missingDeliveryGoal), /chain_deliveryGoalId_must_be_string/);

  const mismatchedFinalMission = validReceipt();
  mismatchedFinalMission.chain.finalMissionId = "another_mission";
  assert.throws(() => validateReceipt(mismatchedFinalMission), /final_mission_id_must_match_apply_mission/);
});

test("binds the chat terminal event to the lifecycle session and result", () => {
  const mismatchedSession = validReceipt();
  mismatchedSession.chain.chatStream.doneSessionId = "session_other";
  assert.throws(() => validateReceipt(mismatchedSession), /chat_stream_done_session/);

  const missingDoneEvent = validReceipt();
  missingDoneEvent.chain.chatStream.eventTypes =
    missingDoneEvent.chain.chatStream.eventTypes.filter((eventType) => eventType !== "done");
  assert.throws(() => validateReceipt(missingDoneEvent), /chain_chat_stream_missing_event:done/);
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
