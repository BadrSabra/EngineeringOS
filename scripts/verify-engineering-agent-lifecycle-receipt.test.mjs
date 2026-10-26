import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEngineeringAgentSourceFingerprint } from "./engineering-agent-source-fingerprint.mjs";
import {
  validateApplyMissionCompletion,
  validateReceipt,
  verifyOfflineReceipt,
} from "./verify-engineering-agent-lifecycle-receipt.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function validReceipt() {
  return {
    schemaVersion: 1,
    runId: "123e4567-e89b-12d3-a456-426614174000",
    startedAt: "2026-10-22T00:00:00.000Z",
    finishedAt: "2026-10-22T00:01:00.000Z",
    environmentIdentity: "replit-disposable-postgres-local-provider-fixture",
    testId: "engineering-agent-lifecycle: completes one correlated Chat-to-Mission apply and delivery chain",
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
      canonicalMissionId: "mission_source",
      sourceGoalId: "goal_source",
      runtimeStartGoalId: "goal_runtime_start",
      sourceExecutionId: "execution_source",
      sourceAttempt: 1,
      acceptanceId: "acceptance_source",
      sourceMissionStatus: "completed",
      sourceMissionGoals: [
        {
          goalId: "goal_runtime_start",
          stepId: "runtime-start",
          status: "completed",
          acceptanceVerdict: "PROVEN",
          approvalState: "NOT_REQUIRED",
        },
        {
          goalId: "goal_source",
          stepId: "execute",
          status: "completed",
          acceptanceVerdict: "PROVEN",
          approvalState: "APPROVED",
        },
        {
          goalId: "goal_validate",
          stepId: "validate",
          status: "completed",
          acceptanceVerdict: "PROVEN",
          approvalState: "NOT_REQUIRED",
        },
      ],
      runtimeTransition: {
        missionId: "mission_source",
        planRevision: "b".repeat(64),
        runtimeStartGoalId: "goal_runtime_start",
        executionId: "execution_runtime",
        attempt: 1,
        acceptanceId: "acceptance_runtime",
        evidenceSnapshotId: "snapshot_runtime",
        transitionId: "transition_runtime",
        targetGoalId: "goal_source",
        outcome: "SUCCEEDED",
        verdict: "PROVEN",
        sourceRevision: "c".repeat(64),
        effectBundleId: "effect_runtime",
        episodeId: "episode_runtime",
        actionId: "action_runtime",
        dispatchType: "AiGoalRecipeDispatchRequested",
        gateCAttestation: {
          kind: "runtime_start_gate_c",
          version: 2,
          executionId: "execution_runtime",
          attempt: 1,
          sourceRevision: "c".repeat(64),
          sourceRevisionKind: "workspace_tree",
          sourceRevisionSource: "delivery_tree_digest_v1",
        },
        transitionProof: {
          transitionId: "transition_runtime",
          executionId: "execution_runtime",
          attempt: 1,
          episodeId: "episode_runtime",
          actionId: "action_runtime",
          effectBundleId: "effect_runtime",
          parentWorldRevision: "d".repeat(64),
          resultingWorldRevision: "e".repeat(64),
          projectRevision: "c".repeat(64),
          environmentRevision: "env-v1:runtime",
          sourceStepId: "runtime-start",
          targetStepId: "execute",
          activePlanHash: "b".repeat(64),
        },
        d2DispatchEventId: "event_d2_runtime",
        taskScope: `scope:${"f".repeat(64)}`,
        parentWorldRevision: "d".repeat(64),
        resultingWorldRevision: "e".repeat(64),
        resultingScopedWorldRevision: "f".repeat(64),
        environmentRevision: "env-v1:runtime",
      },
      proposalId: "proposal_1",
      proposalRevision: 2,
      candidateTreeHash: "c".repeat(64),
      applyMissionId: "mission_apply",
      applyMissionStatus: "completed",
      applyGoalId: "goal_apply",
      applyGoalStatus: "completed",
      applyAcceptanceVerdict: "PROVEN",
      applyExecutionId: "execution_apply",
      deliveryGoalId: "goal_delivery",
      deliveryExecutionId: "execution_delivery",
      applyDeliveryGoalStatus: "completed",
      applyDeliveryReceiptPresent: true,
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

test("does not accept Apply Mission completion as full lifecycle completion when source work is unfinished", () => {
  const chain = validReceipt().chain;
  chain.sourceMissionStatus = "needs_replan";
  chain.sourceMissionGoals[0].status = "needs_replan";
  assert.equal(validateApplyMissionCompletion(chain), true);
  assert.throws(
    () => validateReceipt({ ...validReceipt(), chain }),
    /source_mission_not_completed/,
  );
});

test("rejects a full journey while any required source Mission Goal is unfinished or unproven", () => {
  const unfinished = validReceipt();
  unfinished.chain.sourceMissionGoals[1].status = "queued";
  assert.throws(() => validateReceipt(unfinished), /source_mission_goal_not_completed/);

  const unproven = validReceipt();
  unproven.chain.sourceMissionGoals[1].acceptanceVerdict = "INCOMPLETE";
  assert.throws(() => validateReceipt(unproven), /source_mission_goal_not_proven/);
});

test("requires at least one assisted source Mission approval in the full lifecycle receipt", () => {
  const receipt = validReceipt();
  for (const goal of receipt.chain.sourceMissionGoals) {
    goal.approvalState = "NOT_REQUIRED";
  }
  assert.throws(() => validateReceipt(receipt), /assisted_approval_missing/);
});

test("rejects a canonical Mission identity that differs from the source Mission", () => {
  const receipt = validReceipt();
  receipt.chain.canonicalMissionId = "mission_other";
  assert.throws(() => validateReceipt(receipt), /canonical_source_mission/);
});

test("rejects runtime Gate C, transition, or D2 evidence bound to a different Mission identity", () => {
  const missionMismatch = validReceipt();
  missionMismatch.chain.runtimeTransition.missionId = "mission_other";
  assert.throws(() => validateReceipt(missionMismatch), /runtime_transition_mission_mismatch/);

  const goalMismatch = validReceipt();
  goalMismatch.chain.runtimeTransition.targetGoalId = "goal_other";
  assert.throws(() => validateReceipt(goalMismatch), /runtime_transition_target_goal_mismatch/);

  const executionMismatch = validReceipt();
  executionMismatch.chain.runtimeTransition.transitionProof.executionId = "execution_other";
  assert.throws(() => validateReceipt(executionMismatch), /runtime_transition_d2_executionId_mismatch/);
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

  const missingSourceGoals = validReceipt();
  delete missingSourceGoals.chain.sourceMissionGoals;
  assert.throws(() => validateReceipt(missingSourceGoals), /source_mission_goals_required/);

  const mismatchedFinalMission = validReceipt();
  mismatchedFinalMission.chain.finalMissionId = "another_mission";
  assert.throws(() => validateReceipt(mismatchedFinalMission), /final_mission_id_must_match_apply_mission/);

  const missingRunId = validReceipt();
  delete missingRunId.runId;
  assert.throws(() => validateReceipt(missingRunId), /receipt_missing_runId/);
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
    runId: "123e4567-e89b-12d3-a456-426614174000",
    startedAt: "2026-10-22T00:00:00.000Z",
    finishedAt: "2026-10-22T00:01:00.000Z",
    environmentIdentity: "replit-disposable-postgres-local-provider-fixture",
    testId: "engineering-agent-lifecycle: completes one correlated Chat-to-Mission apply and delivery chain",
    status: "blocked",
    stage: "candidate-execution",
    code: "CANDIDATE_EXECUTION_BLOCKED",
  };
  assert.throws(() => validateReceipt(blocked), /receipt_not_passed/);
});

test("offline verifier validates a retained receipt without a database or temporary project", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "lifecycle-offline-receipt-"));
  const receiptPath = join(temporaryRoot, "receipt.json");
  const reportPath = join(temporaryRoot, "offline-verification.json");
  try {
    const receipt = validReceipt();
    receipt.sourceFingerprint = await computeEngineeringAgentSourceFingerprint({
      cwd: workspaceRoot,
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

    const report = await verifyOfflineReceipt(receiptPath, reportPath);
    const savedReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "passed");
    assert.equal(report.mode, "offline");
    assert.equal(report.runId, receipt.runId);
    assert.equal(report.sourceFingerprint, receipt.sourceFingerprint);
    assert.equal(savedReport.receiptSha256, report.receiptSha256);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("offline verifier returns a typed result when the receipt is missing", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "lifecycle-offline-missing-"));
  try {
    await assert.rejects(
      verifyOfflineReceipt(join(temporaryRoot, "missing.json")),
      /lifecycle_receipt_missing/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
