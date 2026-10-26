import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeEngineeringAgentSourceFingerprint } from "./engineering-agent-source-fingerprint.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lifecycleSentence =
  "Lifecycle acceptance sentinel: retained after approved delivery.";
const receiptKeys = new Set([
  "schemaVersion",
  "runId",
  "startedAt",
  "finishedAt",
  "environmentIdentity",
  "testId",
  "status",
  "stage",
  "code",
  "chain",
  "sourceFingerprint",
]);
const chainKeys = new Set([
  "projectId",
  "chatStream",
  "sessionId",
  "userMessageId",
  "userMessageHash",
  "handoffPlanHash",
  "sourceMissionId",
  "canonicalMissionId",
  "sourceGoalId",
  "runtimeStartGoalId",
  "sourceExecutionId",
  "sourceAttempt",
  "acceptanceId",
  "sourceMissionStatus",
  "sourceMissionGoals",
  "proposalId",
  "proposalRevision",
  "candidateTreeHash",
  "applyMissionId",
  "applyMissionStatus",
  "applyGoalId",
  "applyGoalStatus",
  "applyAcceptanceVerdict",
  "applyExecutionId",
  "deliveryGoalId",
  "deliveryExecutionId",
  "applyDeliveryGoalStatus",
  "applyDeliveryReceiptPresent",
  "commitHash",
  "remoteCommitHash",
  "branch",
  "finalMissionId",
  "engineeringAgentState",
  "activeMissionIdAfterReload",
  "runtimeTransition",
]);

function hasOnlyKeys(value, allowedKeys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}_must_be_object`);
  for (const key of Object.keys(value)) {
    assert.ok(allowedKeys.has(key), `${label}_has_unexpected_key:${key}`);
  }
}

function validateApplyMissionCompletion(chain) {
  assert.equal(chain.applyMissionStatus, "completed", "apply_mission_not_completed");
  assert.equal(chain.applyGoalStatus, "completed", "apply_goal_not_completed");
  assert.equal(chain.applyAcceptanceVerdict, "PROVEN", "apply_goal_not_proven");
  assert.equal(chain.applyDeliveryGoalStatus, "completed", "apply_delivery_goal_not_completed");
  assert.equal(chain.applyDeliveryReceiptPresent, true, "apply_delivery_receipt_missing");
  assert.equal(chain.engineeringAgentState, "COMPLETE", "apply_mission_state_not_complete");
  assert.equal(
    chain.finalMissionId,
    chain.applyMissionId,
    "final_mission_id_must_match_apply_mission",
  );
  assert.equal(chain.commitHash, chain.remoteCommitHash, "apply_delivery_commit_mismatch");
  return true;
}

function validateRuntimeTransition(chain) {
  const runtime = chain.runtimeTransition;
  const runtimeKeys = new Set([
    "missionId",
    "planRevision",
    "runtimeStartGoalId",
    "executionId",
    "attempt",
    "acceptanceId",
    "evidenceSnapshotId",
    "transitionId",
    "targetGoalId",
    "outcome",
    "verdict",
    "sourceRevision",
    "effectBundleId",
    "episodeId",
    "actionId",
    "dispatchType",
    "gateCAttestation",
    "transitionProof",
    "d2DispatchEventId",
    "taskScope",
    "parentWorldRevision",
    "resultingWorldRevision",
    "resultingScopedWorldRevision",
    "environmentRevision",
  ]);
  hasOnlyKeys(runtime, runtimeKeys, "runtime_transition");
  for (const key of [
    "missionId",
    "planRevision",
    "runtimeStartGoalId",
    "executionId",
    "acceptanceId",
    "evidenceSnapshotId",
    "transitionId",
    "targetGoalId",
    "sourceRevision",
    "effectBundleId",
    "episodeId",
    "actionId",
    "dispatchType",
    "d2DispatchEventId",
    "taskScope",
    "parentWorldRevision",
    "resultingWorldRevision",
    "environmentRevision",
  ]) {
    assert.equal(typeof runtime[key], "string", `runtime_transition_${key}_must_be_string`);
    assert.ok(runtime[key].length > 0, `runtime_transition_${key}_must_not_be_empty`);
  }
  assert.equal(runtime.missionId, chain.sourceMissionId, "runtime_transition_mission_mismatch");
  assert.equal(runtime.planRevision, chain.handoffPlanHash, "runtime_transition_plan_mismatch");
  assert.equal(
    runtime.runtimeStartGoalId,
    chain.runtimeStartGoalId,
    "runtime_transition_source_goal_mismatch",
  );
  assert.equal(runtime.targetGoalId, chain.sourceGoalId, "runtime_transition_target_goal_mismatch");
  assert.equal(runtime.outcome, "SUCCEEDED", "runtime_transition_acceptance_not_succeeded");
  assert.equal(runtime.verdict, "PROVEN", "runtime_transition_gate_c_not_proven");
  assert.ok(Number.isInteger(runtime.attempt) && runtime.attempt >= 0, "runtime_transition_attempt_invalid");
  for (const key of ["planRevision", "sourceRevision", "parentWorldRevision", "resultingWorldRevision"]) {
    assert.match(runtime[key], /^[a-f0-9]{64}$/i, `runtime_transition_${key}_invalid`);
  }
  assert.equal(
    runtime.resultingScopedWorldRevision === null
      || /^[a-f0-9]{64}$/i.test(runtime.resultingScopedWorldRevision),
    true,
    "runtime_transition_scoped_revision_invalid",
  );
  assert.equal(
    runtime.dispatchType.startsWith("AiGoal") && runtime.dispatchType.endsWith("DispatchRequested"),
    true,
    "runtime_transition_d2_dispatch_type_invalid",
  );

  const attestation = runtime.gateCAttestation;
  hasOnlyKeys(attestation, new Set([
    "kind",
    "version",
    "executionId",
    "attempt",
    "sourceRevision",
    "sourceRevisionKind",
    "sourceRevisionSource",
  ]), "runtime_transition_gate_c_attestation");
  assert.deepEqual(attestation, {
    kind: "runtime_start_gate_c",
    version: 2,
    executionId: runtime.executionId,
    attempt: runtime.attempt,
    sourceRevision: runtime.sourceRevision,
    sourceRevisionKind: "workspace_tree",
    sourceRevisionSource: "delivery_tree_digest_v1",
  }, "runtime_transition_gate_c_binding_invalid");

  const proof = runtime.transitionProof;
  assert.ok(proof && typeof proof === "object" && !Array.isArray(proof), "runtime_transition_d2_proof_missing");
  for (const [proofKey, runtimeKey] of [
    ["transitionId", "transitionId"],
    ["executionId", "executionId"],
    ["attempt", "attempt"],
    ["episodeId", "episodeId"],
    ["actionId", "actionId"],
    ["effectBundleId", "effectBundleId"],
    ["parentWorldRevision", "parentWorldRevision"],
    ["resultingWorldRevision", "resultingWorldRevision"],
    ["projectRevision", "sourceRevision"],
    ["environmentRevision", "environmentRevision"],
  ]) {
    assert.equal(proof[proofKey], runtime[runtimeKey], `runtime_transition_d2_${proofKey}_mismatch`);
  }
  assert.equal(proof.sourceStepId, "runtime-start", "runtime_transition_d2_source_step_invalid");
  assert.equal(proof.targetStepId, "execute", "runtime_transition_d2_target_step_invalid");
  assert.equal(proof.activePlanHash, runtime.planRevision, "runtime_transition_d2_plan_mismatch");
  return true;
}

function validateReceipt(value, expectedSourceFingerprint = value?.sourceFingerprint) {
  hasOnlyKeys(value, receiptKeys, "receipt");
  for (const required of [
    "schemaVersion",
    "runId",
    "startedAt",
    "finishedAt",
    "environmentIdentity",
    "testId",
    "status",
  ]) {
    assert.ok(Object.hasOwn(value, required), `receipt_missing_${required}`);
  }
  assert.equal(value.schemaVersion, 1, "receipt_schema_version_invalid");
  assert.match(
    typeof value.runId === "string" ? value.runId : "",
    /^[a-f0-9-]{36}$/i,
    "receipt_run_id_invalid",
  );
  assert.ok(
    typeof value.startedAt === "string" && Number.isFinite(Date.parse(value.startedAt)),
    "receipt_started_at_invalid",
  );
  assert.ok(
    typeof value.finishedAt === "string" && Number.isFinite(Date.parse(value.finishedAt)),
    "receipt_finished_at_invalid",
  );
  assert.ok(
    Date.parse(value.finishedAt) >= Date.parse(value.startedAt),
    "receipt_finished_before_started",
  );
  assert.equal(
    value.environmentIdentity,
    "replit-disposable-postgres-local-provider-fixture",
    "receipt_environment_identity_invalid",
  );
  assert.equal(
    value.testId,
    "engineering-agent-lifecycle: completes one correlated Chat-to-Mission apply and delivery chain",
    "receipt_test_id_invalid",
  );
  assert.equal(value.status, "passed", `receipt_not_passed:${value.stage ?? "unknown"}`);
  for (const required of ["stage", "chain", "sourceFingerprint"]) {
    assert.ok(Object.hasOwn(value, required), `receipt_missing_${required}`);
  }
  assert.match(value.sourceFingerprint, /^[a-f0-9]{64}$/, "receipt_source_fingerprint_invalid");
  assert.equal(
    value.sourceFingerprint,
    expectedSourceFingerprint,
    "receipt_source_fingerprint_mismatch",
  );
  assert.equal(value.stage, "complete", "receipt_stage_not_complete");
  assert.equal(Object.hasOwn(value, "code"), false, "passed_receipt_must_not_have_failure_code");
  hasOnlyKeys(value.chain, chainKeys, "chain");
  validateApplyMissionCompletion(value.chain);
  validateRuntimeTransition(value.chain);

  const requiredStringKeys = [
    "projectId",
    "sessionId",
    "userMessageId",
    "userMessageHash",
    "handoffPlanHash",
    "sourceMissionId",
    "canonicalMissionId",
    "sourceGoalId",
    "runtimeStartGoalId",
    "sourceExecutionId",
    "acceptanceId",
    "sourceMissionStatus",
    "proposalId",
    "candidateTreeHash",
    "applyMissionId",
    "applyMissionStatus",
    "applyGoalId",
    "applyGoalStatus",
    "applyAcceptanceVerdict",
    "applyExecutionId",
    "deliveryGoalId",
    "deliveryExecutionId",
    "applyDeliveryGoalStatus",
    "commitHash",
    "remoteCommitHash",
    "branch",
    "finalMissionId",
    "engineeringAgentState",
    "activeMissionIdAfterReload",
  ];
  for (const key of requiredStringKeys) {
    assert.equal(typeof value.chain[key], "string", `chain_${key}_must_be_string`);
    assert.ok(value.chain[key].length > 0, `chain_${key}_must_not_be_empty`);
  }
  for (const key of [
    "projectId",
    "sessionId",
    "userMessageId",
    "sourceMissionId",
    "canonicalMissionId",
    "sourceGoalId",
    "sourceExecutionId",
    "acceptanceId",
    "proposalId",
    "applyMissionId",
    "applyGoalId",
    "applyExecutionId",
    "deliveryGoalId",
    "deliveryExecutionId",
    "finalMissionId",
    "activeMissionIdAfterReload",
  ]) {
    assert.match(value.chain[key], /^[A-Za-z0-9_-]{1,160}$/, `chain_${key}_invalid`);
  }
  assert.equal(value.chain.sourceMissionStatus, "completed", "source_mission_not_completed");
  assert.equal(value.chain.applyMissionStatus, "completed", "apply_mission_not_completed");
  assert.equal(value.chain.applyGoalStatus, "completed", "apply_goal_not_completed");
  assert.equal(value.chain.applyAcceptanceVerdict, "PROVEN", "apply_goal_not_proven");
  assert.equal(
    value.chain.applyDeliveryGoalStatus,
    "completed",
    "apply_delivery_goal_not_completed",
  );
  assert.equal(value.chain.applyDeliveryReceiptPresent, true, "apply_delivery_receipt_missing");
  assert.ok(
    Array.isArray(value.chain.sourceMissionGoals)
      && value.chain.sourceMissionGoals.length > 0
      && value.chain.sourceMissionGoals.length <= 32,
    "source_mission_goals_required",
  );
  const sourceGoalIds = new Set();
  for (const sourceGoal of value.chain.sourceMissionGoals) {
    hasOnlyKeys(
      sourceGoal,
      new Set(["goalId", "stepId", "status", "acceptanceVerdict", "approvalState"]),
      "source_mission_goal",
    );
    for (const key of ["goalId", "stepId", "status", "acceptanceVerdict", "approvalState"]) {
      assert.equal(typeof sourceGoal[key], "string", `source_mission_goal_${key}_invalid`);
      assert.ok(sourceGoal[key].length > 0, `source_mission_goal_${key}_empty`);
    }
    assert.ok(!sourceGoalIds.has(sourceGoal.goalId), "source_mission_goal_duplicate");
    sourceGoalIds.add(sourceGoal.goalId);
    assert.equal(sourceGoal.status, "completed", "source_mission_goal_not_completed");
    assert.equal(sourceGoal.acceptanceVerdict, "PROVEN", "source_mission_goal_not_proven");
    assert.ok(
      ["APPROVED", "NOT_REQUIRED"].includes(sourceGoal.approvalState),
      "source_mission_goal_approval_not_satisfied",
    );
  }
  assert.ok(
    sourceGoalIds.has(value.chain.runtimeStartGoalId),
    "runtime_start_goal_missing_from_source_goal_states",
  );
  assert.ok(
    value.chain.sourceMissionGoals.some(
      (sourceGoal) => sourceGoal.approvalState === "APPROVED",
    ),
    "assisted_approval_missing",
  );
  const chatStream = value.chain.chatStream;
  const chatStreamKeys = new Set([
    "eventTypes",
    "sessionStarted",
    "sessionStartedSessionId",
    "doneHasSessionId",
    "doneSessionId",
    "sessionIdsMatch",
    "doneMessageId",
    "doneMessageRole",
    "doneMessageContentLength",
    "doneTurnIntent",
    "doneTaskResultKind",
  ]);
  hasOnlyKeys(chatStream, chatStreamKeys, "chain_chat_stream");
  assert.ok(
    Array.isArray(chatStream.eventTypes)
      && chatStream.eventTypes.every((eventType) => typeof eventType === "string"),
    "chain_chat_stream_event_types_invalid",
  );
  for (const requiredEventType of [
    "session_started",
    "stage",
    "execution_started",
    "intent",
    "behavior_progress",
    "delta",
    "recipe_terminal",
    "done",
  ]) {
    assert.ok(
      chatStream.eventTypes.includes(requiredEventType),
      `chain_chat_stream_missing_event:${requiredEventType}`,
    );
  }
  requireValue(chatStream.sessionStarted, true, "chat_stream_session_started");
  requireValue(
    chatStream.sessionStartedSessionId,
    value.chain.sessionId,
    "chat_stream_started_session",
  );
  requireValue(chatStream.doneHasSessionId, true, "chat_stream_done_session_present");
  requireValue(chatStream.doneSessionId, value.chain.sessionId, "chat_stream_done_session");
  requireValue(chatStream.sessionIdsMatch, true, "chat_stream_session_identity");
  assert.match(
    chatStream.doneMessageId,
    /^[A-Za-z0-9_-]{1,160}$/,
    "chain_chat_stream_done_message_id_invalid",
  );
  requireValue(chatStream.doneMessageRole, "assistant", "chat_stream_done_message_role");
  assert.ok(
    Number.isSafeInteger(chatStream.doneMessageContentLength)
      && chatStream.doneMessageContentLength > 0,
    "chain_chat_stream_done_message_content_length_invalid",
  );
  requireValue(chatStream.doneTurnIntent, "DELIVERY", "chat_stream_done_turn_intent");
  requireValue(
    chatStream.doneTaskResultKind,
    "IMPLEMENTATION_PLAN_RESULT",
    "chat_stream_done_task_result",
  );
  assert.ok(Number.isSafeInteger(value.chain.sourceAttempt) && value.chain.sourceAttempt >= 0);
  assert.ok(Number.isSafeInteger(value.chain.proposalRevision) && value.chain.proposalRevision >= 0);
  assert.match(value.chain.userMessageHash, /^[a-f0-9]{64}$/);
  assert.match(value.chain.handoffPlanHash, /^[a-f0-9]{64}$/);
  assert.match(value.chain.candidateTreeHash, /^[a-f0-9]{64}$/);
  assert.match(value.chain.commitHash, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  assert.match(value.chain.remoteCommitHash, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  assert.equal(value.chain.branch, "main");
  assert.equal(value.chain.engineeringAgentState, "COMPLETE");
  assert.equal(
    value.chain.canonicalMissionId,
    value.chain.sourceMissionId,
    "canonical_source_mission",
  );
  assert.equal(
    value.chain.finalMissionId,
    value.chain.applyMissionId,
    "final_mission_id_must_match_apply_mission",
  );
  assert.equal(
    value.chain.activeMissionIdAfterReload,
    value.chain.sourceMissionId,
    "reloaded_chat_must_retain_source_mission",
  );
  return value;
}

async function writeJsonAtomically(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(contents);
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function verifyOfflineReceipt(receiptPath, reportPath) {
  assert.ok(receiptPath, "lifecycle_receipt_path_required");
  const resolvedReceiptPath = resolve(receiptPath);
  const currentSourceFingerprint = await computeEngineeringAgentSourceFingerprint({
    cwd: workspaceRoot,
  });
  const receiptText = await readFile(resolvedReceiptPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") throw new Error("lifecycle_receipt_missing");
    throw error;
  });
  const receipt = validateReceipt(
    JSON.parse(receiptText),
    currentSourceFingerprint,
  );
  const report = {
    schemaVersion: 1,
    status: "passed",
    mode: "offline",
    verifiedAt: new Date().toISOString(),
    runId: receipt.runId,
    testId: receipt.testId,
    receiptFile: relative(workspaceRoot, resolvedReceiptPath).split(sep).join("/"),
    receiptSha256: createHash("sha256").update(receiptText).digest("hex"),
    sourceFingerprint: currentSourceFingerprint,
  };
  if (reportPath) {
    await writeJsonAtomically(resolve(reportPath), report);
  }
  console.log(
    `Lifecycle receipt offline verification passed: ${report.receiptFile} ${report.sourceFingerprint}.`,
  );
  return report;
}

function idSql(value, label) {
  assert.match(value, /^[A-Za-z0-9_-]{1,160}$/, `${label}_unsafe_identifier`);
  return `'${value}'`;
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getAtPath(value, path) {
  return path.split(".").reduce((current, key) => (
    current && typeof current === "object" ? current[key] : undefined
  ), value);
}

function requireValue(actual, expected, code) {
  assert.equal(actual, expected, `lifecycle_verification_failed:${code}`);
}

function readDatabaseSnapshot(databaseUrl, chain) {
  const ids = Object.fromEntries(
    Object.entries(chain).map(([key, value]) => [
      key,
      typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value)
        ? idSql(value, key)
        : null,
    ]),
  );
  const query = `
    SELECT json_build_object(
      'project', (SELECT to_jsonb(p) FROM projects p WHERE p.id = ${ids.projectId}),
      'session', (SELECT to_jsonb(s) FROM ai_chat_sessions s WHERE s.id = ${ids.sessionId}),
      'message', (SELECT to_jsonb(m) FROM ai_chat_messages m WHERE m.id = ${ids.userMessageId}),
      'handoff', (SELECT to_jsonb(h) FROM ai_mission_handoffs h WHERE h.mission_id = ${ids.sourceMissionId}),
      'sourceMission', (SELECT to_jsonb(m) FROM ai_missions m WHERE m.id = ${ids.sourceMissionId}),
      'sourceGoal', (SELECT to_jsonb(g) FROM ai_goals g WHERE g.id = ${ids.sourceGoalId}),
      'sourceGoals', COALESCE((
        SELECT json_agg(to_jsonb(g) ORDER BY g.created_at, g.id)
        FROM ai_goals g
        WHERE g.mission_id = ${ids.sourceMissionId}
      ), '[]'::json),
      'sourceTasks', COALESCE((
        SELECT json_agg(json_build_object(
          'id', t.id,
          'goalId', t.goal_id,
          'projectId', t.project_id,
          'status', t.status
        ) ORDER BY t.created_at, t.id)
        FROM tasks t
        JOIN ai_goals g ON g.id = t.goal_id
        WHERE g.mission_id = ${ids.sourceMissionId}
      ), '[]'::json),
      'sourceExecution', (SELECT to_jsonb(e) FROM ai_executions e WHERE e.id = ${ids.sourceExecutionId}),
      'sourceAcceptances', COALESCE((
        SELECT json_agg(to_jsonb(a))
        FROM ai_execution_acceptances a
        WHERE a.execution_id = ${ids.sourceExecutionId}
          AND a.attempt = ${Number(chain.sourceAttempt)}
      ), '[]'::json),
      'applyAcceptances', COALESCE((
        SELECT json_agg(to_jsonb(a))
        FROM ai_execution_acceptances a
        WHERE a.execution_id = ${ids.applyExecutionId}
      ), '[]'::json),
      'deliveryAcceptances', COALESCE((
        SELECT json_agg(to_jsonb(a))
        FROM ai_execution_acceptances a
        WHERE a.execution_id = ${ids.deliveryExecutionId}
      ), '[]'::json),
      'proposal', (SELECT to_jsonb(p) FROM ai_change_proposals p WHERE p.id = ${ids.proposalId}),
      'proposalMessage', (
        SELECT to_jsonb(m)
        FROM ai_chat_messages m
        WHERE m.id = (
          SELECT p.message_id FROM ai_change_proposals p WHERE p.id = ${ids.proposalId}
        )
      ),
      'applyMission', (SELECT to_jsonb(m) FROM ai_missions m WHERE m.id = ${ids.applyMissionId}),
      'applyGoals', COALESCE((
        SELECT json_agg(to_jsonb(g) ORDER BY g.created_at, g.id)
        FROM ai_goals g
        WHERE g.mission_id = ${ids.applyMissionId}
      ), '[]'::json),
      'applyTasks', COALESCE((
        SELECT json_agg(json_build_object(
          'id', t.id,
          'goalId', t.goal_id,
          'projectId', t.project_id,
          'status', t.status
        ) ORDER BY t.created_at, t.id)
        FROM tasks t
        JOIN ai_goals g ON g.id = t.goal_id
        WHERE g.mission_id = ${ids.applyMissionId}
      ), '[]'::json),
      'lineage', (
        SELECT to_jsonb(l)
        FROM ai_mission_lineages l
        WHERE l.apply_mission_id = ${ids.applyMissionId}
      ),
      'applyGoal', (SELECT to_jsonb(g) FROM ai_goals g WHERE g.id = ${ids.applyGoalId}),
      'applyExecution', (SELECT to_jsonb(e) FROM ai_executions e WHERE e.id = ${ids.applyExecutionId}),
      'deliveryGoal', (SELECT to_jsonb(g) FROM ai_goals g WHERE g.id = ${ids.deliveryGoalId}),
      'deliveryExecution', (SELECT to_jsonb(e) FROM ai_executions e WHERE e.id = ${ids.deliveryExecutionId})
    )::text;
  `;
  const output = execFileSync("psql", [
    "--no-psqlrc",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    databaseUrl,
    "--command",
    query,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: databaseUrl, PGCONNECT_TIMEOUT: "5" },
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  assert.ok(output, "lifecycle_database_snapshot_empty");
  return JSON.parse(output);
}

function verifyDatabaseSnapshot(snapshot, chain) {
  const requireRow = (name) => {
    assert.ok(snapshot[name] && typeof snapshot[name] === "object", `lifecycle_row_missing:${name}`);
    return snapshot[name];
  };

  const project = requireRow("project");
  const session = requireRow("session");
  const message = requireRow("message");
  const handoff = requireRow("handoff");
  const sourceMission = requireRow("sourceMission");
  const sourceGoal = requireRow("sourceGoal");
  assert.ok(Array.isArray(snapshot.sourceGoals), "source_mission_goals_invalid");
  assert.ok(Array.isArray(snapshot.sourceTasks), "source_mission_tasks_invalid");
  assert.ok(Array.isArray(snapshot.applyGoals), "apply_mission_goals_invalid");
  assert.ok(Array.isArray(snapshot.applyTasks), "apply_mission_tasks_invalid");
  assert.ok(Array.isArray(snapshot.applyAcceptances), "apply_acceptance_rows_invalid");
  assert.ok(Array.isArray(snapshot.deliveryAcceptances), "delivery_acceptance_rows_invalid");
  const sourceExecution = requireRow("sourceExecution");
  const proposal = requireRow("proposal");
  const proposalMessage = requireRow("proposalMessage");
  const applyMission = requireRow("applyMission");
  const lineage = requireRow("lineage");
  const applyGoal = requireRow("applyGoal");
  const applyExecution = requireRow("applyExecution");
  const deliveryGoal = requireRow("deliveryGoal");
  const deliveryExecution = requireRow("deliveryExecution");

  requireValue(project.id, chain.projectId, "project_id");
  requireValue(session.project_id, chain.projectId, "chat_session_project");
  requireValue(session.active_mission_id, chain.activeMissionIdAfterReload, "chat_active_mission");
  requireValue(message.session_id, chain.sessionId, "user_message_session");
  requireValue(message.role, "user", "user_message_role");
  requireValue(
    createHash("sha256").update(message.content).digest("hex"),
    chain.userMessageHash,
    "user_message_content",
  );

  requireValue(handoff.project_id, chain.projectId, "handoff_project");
  requireValue(handoff.mission_id, chain.sourceMissionId, "handoff_mission");
  requireValue(handoff.session_id, chain.sessionId, "handoff_session");
  requireValue(handoff.message_id, chain.userMessageId, "handoff_user_message");
  requireValue(handoff.plan_hash, chain.handoffPlanHash, "handoff_plan_hash");
  requireValue(handoff.dispatch_status, "dispatched", "handoff_dispatch_status");
  requireValue(
    getAtPath(handoff.activation_plan, "primary.goalId"),
    chain.sourceGoalId,
    "handoff_primary_goal",
  );

  requireValue(sourceMission.project_id, chain.projectId, "source_mission_project");
  requireValue(getAtPath(sourceMission.scope, "projectId"), chain.projectId, "source_mission_scope");
  requireValue(sourceMission.status, chain.sourceMissionStatus, "source_mission_status_receipt");
  requireValue(sourceMission.status, "completed", "source_mission_status");
  assert.equal(snapshot.sourceGoals.length, chain.sourceMissionGoals.length, "source_mission_goal_count");
  const sourceGoalsById = new Map(snapshot.sourceGoals.map((goal) => [goal.id, goal]));
  for (const sourceGoalReceipt of chain.sourceMissionGoals) {
    const sourceGoalRow = sourceGoalsById.get(sourceGoalReceipt.goalId);
    assert.ok(sourceGoalRow, `source_mission_goal_missing:${sourceGoalReceipt.goalId}`);
    requireValue(sourceGoalRow.status, sourceGoalReceipt.status, "source_mission_goal_status_receipt");
    requireValue(sourceGoalRow.status, "completed", "source_mission_goal_status");
    requireValue(
      getAtPath(sourceGoalRow.outcome_contract, "stepId")
        ?? getAtPath(sourceGoalRow.success_criteria, "stepId"),
      sourceGoalReceipt.stepId,
      "source_mission_goal_step_id",
    );
    requireValue(
      getAtPath(sourceGoalRow.outcome_contract, "acceptance.verdict"),
      sourceGoalReceipt.acceptanceVerdict,
      "source_mission_goal_acceptance_verdict",
    );
    requireValue(
      getAtPath(sourceGoalRow.outcome_contract, "planApproval.state") ?? "NOT_REQUIRED",
      sourceGoalReceipt.approvalState,
      "source_mission_goal_approval_state",
    );
  }
  assert.ok(snapshot.sourceTasks.length > 0, "source_mission_tasks_missing");
  const sourceGoalIds = new Set(snapshot.sourceGoals.map((goal) => goal.id));
  const sourceTaskIds = new Set();
  for (const task of snapshot.sourceTasks) {
    assert.ok(!sourceTaskIds.has(task.id), "source_mission_task_duplicate");
    sourceTaskIds.add(task.id);
    requireValue(task.projectId, chain.projectId, "source_task_project");
    assert.ok(sourceGoalIds.has(task.goalId), "source_task_goal_mission_mismatch");
    requireValue(task.status, "completed", "source_task_not_completed");
  }
  requireValue(sourceGoal.mission_id, chain.sourceMissionId, "source_goal_mission");
  requireValue(sourceGoal.project_id, chain.projectId, "source_goal_project");
  requireValue(sourceGoal.status, "completed", "source_goal_status");
  requireValue(sourceExecution.project_id, chain.projectId, "source_execution_project");
  requireValue(sourceExecution.goal_id, chain.sourceGoalId, "source_execution_goal");
  requireValue(sourceExecution.attempt, chain.sourceAttempt, "source_execution_attempt");
  requireValue(sourceExecution.status, "completed", "source_execution_status");
  requireValue(sourceExecution.proposal_id, chain.proposalId, "source_execution_proposal");

  const sourceAcceptance = getAtPath(sourceGoal.outcome_contract, "acceptance");
  requireValue(sourceAcceptance?.acceptanceId, chain.acceptanceId, "source_goal_acceptance_id");
  requireValue(sourceAcceptance?.executionId, chain.sourceExecutionId, "source_goal_acceptance_execution");
  requireValue(sourceAcceptance?.outcome, "SUCCEEDED", "source_goal_acceptance_outcome");
  requireValue(sourceAcceptance?.verdict, "PROVEN", "source_goal_acceptance_verdict");
  assert.match(
    sourceAcceptance?.candidateIdentity ?? "",
    /^mission-candidate:[a-f0-9]{64}$/,
    "source_goal_candidate_identity_invalid",
  );
  assert.ok(Array.isArray(snapshot.sourceAcceptances), "source_acceptance_rows_invalid");
  const acceptedRow = snapshot.sourceAcceptances.find((row) => row.id === chain.acceptanceId);
  assert.ok(acceptedRow, "source_acceptance_row_missing");
  requireValue(acceptedRow.execution_id, chain.sourceExecutionId, "acceptance_execution");
  requireValue(acceptedRow.attempt, chain.sourceAttempt, "acceptance_attempt");
  requireValue(
    acceptedRow.candidate_identity,
    sourceAcceptance.candidateIdentity,
    "acceptance_candidate_identity",
  );
  requireValue(acceptedRow.terminal_status, "completed", "acceptance_terminal_status");

  requireValue(proposal.project_id, chain.projectId, "proposal_project");
  requireValue(proposal.session_id, chain.sessionId, "proposal_session");
  requireValue(proposal.revision, chain.proposalRevision, "proposal_revision");
  requireValue(proposal.status, "applied", "proposal_status");
  requireValue(proposal.approval_required, false, "proposal_approval");
  requireValue(proposal.lifecycle, "committed", "proposal_lifecycle");
  requireValue(proposal.candidate_tree_hash, chain.candidateTreeHash, "proposal_candidate_hash");
  requireValue(proposal.commit_hash, chain.commitHash, "proposal_commit_hash");
  requireValue(proposal.promoted_tree_hash, chain.candidateTreeHash, "proposal_promoted_tree");
  requireValue(proposal.committed_tree_hash, chain.candidateTreeHash, "proposal_committed_tree");
  let proposalValidationEvidence;
  try {
    proposalValidationEvidence = JSON.parse(proposal.validation_evidence ?? "null");
  } catch {
    proposalValidationEvidence = null;
  }
  assert.ok(
    Array.isArray(proposalValidationEvidence)
      && proposalValidationEvidence[0]
      && typeof proposalValidationEvidence[0] === "object",
    "proposal_validation_binding_missing",
  );
  const promotedValidation = proposalValidationEvidence.find((entry) =>
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && entry.status === "passed"
    && entry.evidence
    && typeof entry.evidence === "object"
    && !Array.isArray(entry.evidence)
    && entry.evidence.candidateHash === chain.candidateTreeHash
    && entry.evidence.changeSetHash === proposal.change_set_hash
    && entry.evidence.promotedHash === chain.candidateTreeHash,
  );
  assert.ok(
    promotedValidation,
    "proposal_validation_does_not_bind_passed_candidate_change_set_and_promotion",
  );
  assert.ok(typeof proposal.applied_changes === "string" && proposal.applied_changes.length > 0);
  requireValue(proposalMessage.session_id, chain.sessionId, "proposal_message_session");
  requireValue(proposalMessage.role, "assistant", "proposal_message_role");

  requireValue(applyMission.project_id, chain.projectId, "apply_mission_project");
  requireValue(applyMission.status, chain.applyMissionStatus, "apply_mission_status_receipt");
  requireValue(applyMission.status, "completed", "apply_mission_status");
  requireValue(chain.canonicalMissionId, chain.sourceMissionId, "canonical_source_mission");
  requireValue(lineage.apply_mission_id, chain.applyMissionId, "lineage_apply_mission");
  requireValue(lineage.canonical_mission_id, chain.canonicalMissionId, "lineage_canonical_mission");
  requireValue(lineage.source_execution_id, chain.sourceExecutionId, "lineage_source_execution");
  requireValue(lineage.source_goal_id, chain.sourceGoalId, "lineage_source_goal");
  requireValue(lineage.source_acceptance_id, chain.acceptanceId, "lineage_source_acceptance");
  requireValue(lineage.proposal_id, chain.proposalId, "lineage_proposal");
  requireValue(lineage.project_id, chain.projectId, "lineage_project");
  assert.notEqual(
    lineage.apply_mission_id,
    lineage.canonical_mission_id,
    "apply_and_canonical_mission_ids_must_remain_distinct",
  );
  const applyRequirement = getAtPath(
    applyMission.autonomy_policy,
    "applyMission",
  );
  requireValue(applyRequirement?.proposalId, chain.proposalId, "apply_mission_proposal");
  requireValue(applyRequirement?.proposalRevision, chain.proposalRevision, "apply_mission_revision");
  requireValue(
    applyRequirement?.candidateTreeHash,
    chain.candidateTreeHash,
    "apply_mission_candidate_hash",
  );
  requireValue(
    applyRequirement?.candidateIdentity,
    `${chain.proposalId}:${chain.candidateTreeHash}`,
    "apply_mission_candidate_identity",
  );
  assert.ok(snapshot.applyGoals.length > 0, "apply_mission_goals_missing");
  const applyGoalIds = new Set();
  for (const goal of snapshot.applyGoals) {
    assert.ok(!applyGoalIds.has(goal.id), "apply_mission_goal_duplicate");
    applyGoalIds.add(goal.id);
    requireValue(goal.mission_id, chain.applyMissionId, "apply_goal_mission_membership");
    requireValue(goal.project_id, chain.projectId, "apply_goal_project_membership");
    requireValue(goal.status, "completed", "apply_mission_goal_not_completed");
    requireValue(
      getAtPath(goal.outcome_contract, "acceptance.verdict"),
      "PROVEN",
      "apply_mission_goal_not_proven",
    );
  }
  assert.ok(applyGoalIds.has(chain.applyGoalId), "apply_goal_missing_from_mission");
  assert.ok(applyGoalIds.has(chain.deliveryGoalId), "delivery_goal_missing_from_mission");
  assert.ok(snapshot.applyTasks.length > 0, "apply_mission_tasks_missing");
  const applyTaskIds = new Set();
  for (const task of snapshot.applyTasks) {
    assert.ok(!applyTaskIds.has(task.id), "apply_mission_task_duplicate");
    applyTaskIds.add(task.id);
    requireValue(task.projectId, chain.projectId, "apply_task_project");
    assert.ok(applyGoalIds.has(task.goalId), "apply_task_goal_mission_mismatch");
    requireValue(task.status, "completed", "apply_task_not_completed");
  }
  requireValue(applyGoal.mission_id, chain.applyMissionId, "apply_goal_mission");
  requireValue(applyGoal.project_id, chain.projectId, "apply_goal_project");
  requireValue(applyGoal.status, chain.applyGoalStatus, "apply_goal_status_receipt");
  requireValue(applyGoal.status, "completed", "apply_goal_status");
  requireValue(applyExecution.project_id, chain.projectId, "apply_execution_project");
  requireValue(applyExecution.goal_id, chain.applyGoalId, "apply_execution_goal");
  requireValue(applyExecution.status, "completed", "apply_execution_status");
  const applyAcceptance = getAtPath(applyGoal.outcome_contract, "acceptance");
  requireValue(applyAcceptance?.executionId, chain.applyExecutionId, "apply_acceptance_execution");
  requireValue(
    applyAcceptance?.verdict,
    chain.applyAcceptanceVerdict,
    "apply_acceptance_verdict_receipt",
  );
  requireValue(applyAcceptance?.verdict, "PROVEN", "apply_acceptance_verdict");
  assert.ok(
    typeof applyAcceptance?.acceptanceId === "string",
    "apply_acceptance_id_missing",
  );
  const applyAcceptanceRow = snapshot.applyAcceptances.find(
    (row) => row.id === applyAcceptance.acceptanceId,
  );
  assert.ok(applyAcceptanceRow, "apply_acceptance_row_missing");
  requireValue(
    applyAcceptanceRow.execution_id,
    chain.applyExecutionId,
    "apply_acceptance_execution_row",
  );
  requireValue(
    applyAcceptanceRow.terminal_status,
    "completed",
    "apply_acceptance_terminal_status",
  );
  requireValue(
    applyAcceptanceRow.attempt,
    applyExecution.attempt,
    "apply_acceptance_attempt",
  );

  requireValue(deliveryGoal.mission_id, chain.applyMissionId, "delivery_goal_mission");
  requireValue(deliveryGoal.status, chain.applyDeliveryGoalStatus, "delivery_goal_status_receipt");
  requireValue(deliveryGoal.status, "completed", "delivery_goal_status");
  requireValue(deliveryExecution.project_id, chain.projectId, "delivery_execution_project");
  requireValue(deliveryExecution.goal_id, chain.deliveryGoalId, "delivery_execution_goal");
  requireValue(deliveryExecution.id, chain.deliveryExecutionId, "delivery_execution_identity");
  requireValue(deliveryExecution.status, "completed", "delivery_execution_status");
  const deliveryAcceptance = getAtPath(deliveryGoal.outcome_contract, "acceptance");
  assert.ok(
    typeof deliveryAcceptance?.acceptanceId === "string",
    "delivery_acceptance_id_missing",
  );
  const deliveryAcceptanceRow = snapshot.deliveryAcceptances.find(
    (row) => row.id === deliveryAcceptance.acceptanceId,
  );
  assert.ok(deliveryAcceptanceRow, "delivery_acceptance_row_missing");
  requireValue(
    deliveryAcceptanceRow.execution_id,
    chain.deliveryExecutionId,
    "delivery_acceptance_execution_row",
  );
  requireValue(
    deliveryAcceptanceRow.terminal_status,
    "completed",
    "delivery_acceptance_terminal_status",
  );
  requireValue(
    deliveryAcceptanceRow.attempt,
    deliveryExecution.attempt,
    "delivery_acceptance_attempt",
  );
  requireValue(
    deliveryAcceptance?.executionId,
    chain.deliveryExecutionId,
    "delivery_acceptance_execution",
  );
  requireValue(deliveryAcceptance?.verdict, "PROVEN", "delivery_acceptance_verdict");
  const deliveryReceipt = deliveryAcceptance?.deliveryReceipt;
  assert.ok(deliveryReceipt && typeof deliveryReceipt === "object", "delivery_receipt_missing");
  requireValue(deliveryReceipt.executionId, chain.deliveryExecutionId, "delivery_receipt_execution");
  requireValue(deliveryReceipt.status, "completed", "delivery_receipt_status");

  return {
    project: { id: chain.projectId },
    missions: [
      { id: sourceMission.id, role: "canonical", status: sourceMission.status },
      { id: applyMission.id, role: "apply", status: applyMission.status },
    ],
    goals: [
      ...snapshot.sourceGoals.map((goal) => ({
        id: goal.id,
        missionId: goal.mission_id,
        status: goal.status,
        acceptanceVerdict: getAtPath(goal.outcome_contract, "acceptance.verdict") ?? null,
      })),
      ...snapshot.applyGoals.map((goal) => ({
        id: goal.id,
        missionId: goal.mission_id,
        status: goal.status,
        acceptanceVerdict: getAtPath(goal.outcome_contract, "acceptance.verdict") ?? null,
      })),
    ],
    tasks: {
      sourceMission: snapshot.sourceTasks,
      applyMission: snapshot.applyTasks,
    },
    executions: [
      { id: sourceExecution.id, goalId: sourceExecution.goal_id, status: sourceExecution.status },
      { id: applyExecution.id, goalId: applyExecution.goal_id, status: applyExecution.status },
      { id: deliveryExecution.id, goalId: deliveryExecution.goal_id, status: deliveryExecution.status },
    ],
    acceptances: [
      {
        id: sourceAcceptance?.acceptanceId ?? chain.acceptanceId,
        executionId: sourceAcceptance?.executionId ?? null,
        verdict: sourceAcceptance?.verdict ?? null,
      },
      {
        id: applyAcceptance?.acceptanceId ?? null,
        executionId: applyAcceptance?.executionId ?? null,
        verdict: applyAcceptance?.verdict ?? null,
      },
      {
        id: deliveryAcceptance?.acceptanceId ?? null,
        executionId: deliveryAcceptance?.executionId ?? null,
        verdict: deliveryAcceptance?.verdict ?? null,
      },
    ],
    proposal: { id: proposal.id, status: proposal.status },
    deliveryReceipt: {
      id: deliveryReceipt.receiptId ?? deliveryReceipt.id ?? null,
      executionId: deliveryReceipt.executionId,
      status: deliveryReceipt.status,
    },
    delivery: {
      commitHash: chain.commitHash,
      remoteCommitHash: chain.remoteCommitHash,
      branch: chain.branch,
    },
  };
}

async function verifyLiveReceipt() {
  const databaseUrl = process.env.DATABASE_URL;
  const receiptPath = process.env.ENGINEERING_AGENT_LIFECYCLE_RECEIPT;
  const projectRoot = process.env.ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT;
  const remotePath = process.env.ENGINEERING_AGENT_LIFECYCLE_REMOTE;
  assert.ok(databaseUrl && receiptPath && projectRoot && remotePath, "lifecycle_verifier_environment_missing");
  const parsedDatabaseUrl = new URL(databaseUrl);
  assert.ok(
    ["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname),
    "lifecycle_verifier_requires_loopback_database",
  );

  const currentSourceFingerprint = await computeEngineeringAgentSourceFingerprint({
    cwd: workspaceRoot,
  });
  const receiptText = await readFile(receiptPath, "utf8");
  const receipt = validateReceipt(
    JSON.parse(receiptText),
    currentSourceFingerprint,
  );
  const { chain } = receipt;
  const projectRealPath = await realpath(projectRoot);
  const workspaceRelative = relative(await realpath(workspaceRoot), projectRealPath);
  assert.ok(
    workspaceRelative
      && workspaceRelative !== ".."
      && !workspaceRelative.startsWith(`..${sep}`)
      && workspaceRelative.startsWith(`test-results${sep}engineering-agent-lifecycle${sep}project-`),
    "lifecycle_project_root_outside_disposable_workspace",
  );
  const remoteRealPath = await realpath(remotePath);
  const temporaryRelative = relative(await realpath(os.tmpdir()), remoteRealPath);
  assert.ok(
    temporaryRelative
      && temporaryRelative !== ".."
      && !temporaryRelative.startsWith(`..${sep}`)
      && temporaryRelative.split(sep)[0].startsWith("engineeringos-goal-first-e2e-"),
    "lifecycle_remote_outside_disposable_runner_root",
  );
  requireValue(
    runGit(projectRealPath, ["rev-parse", "HEAD"]),
    chain.commitHash,
    "local_commit_hash",
  );
  requireValue(
    runGit(projectRealPath, [
      "--git-dir",
      remoteRealPath,
      "rev-parse",
      `refs/heads/${chain.branch}`,
    ]),
    chain.remoteCommitHash,
    "remote_commit_hash",
  );
  requireValue(chain.remoteCommitHash, chain.commitHash, "local_remote_commit_identity");
  const localReadme = await readFile(resolve(projectRealPath, "README.md"), "utf8");
  assert.ok(localReadme.split("\n").includes(lifecycleSentence), "local_delivery_content_missing");
  const remoteReadme = runGit(projectRealPath, [
    "--git-dir",
    remoteRealPath,
    "show",
    `refs/heads/${chain.branch}:README.md`,
  ]);
  assert.ok(remoteReadme.split("\n").includes(lifecycleSentence), "remote_delivery_content_missing");

  const snapshot = readDatabaseSnapshot(databaseUrl, chain);
  const databaseSummary = verifyDatabaseSnapshot(snapshot, chain);
  const liveVerificationPath =
    process.env.ENGINEERING_AGENT_LIFECYCLE_LIVE_VERIFICATION;
  const liveVerification = {
    schemaVersion: 1,
    status: "passed",
    mode: "live",
    verifiedAt: new Date().toISOString(),
    runId: receipt.runId,
    receipt: {
      path: relative(workspaceRoot, resolve(receiptPath)).split(sep).join("/"),
      sha256: createHash("sha256").update(receiptText).digest("hex"),
      sourceFingerprint: receipt.sourceFingerprint,
    },
    identities: {
      sourceMissionId: chain.sourceMissionId,
      canonicalMissionId: chain.canonicalMissionId,
      sourceGoalId: chain.sourceGoalId,
      sourceExecutionId: chain.sourceExecutionId,
      sourceAcceptanceId: chain.acceptanceId,
      proposalId: chain.proposalId,
      applyMissionId: chain.applyMissionId,
      applyGoalId: chain.applyGoalId,
      applyExecutionId: chain.applyExecutionId,
      deliveryGoalId: chain.deliveryGoalId,
      deliveryExecutionId: chain.deliveryExecutionId,
    },
    database: databaseSummary,
  };
  if (liveVerificationPath) {
    await writeJsonAtomically(liveVerificationPath, liveVerification);
  }
  console.log(JSON.stringify(liveVerification));
  console.log(
    "Lifecycle receipt verified: durable Chat/Mission/proof/approval/apply links and the local bare-remote commit match.",
  );
}

async function main(args = process.argv.slice(2)) {
  if (args[0] === "--offline") {
    await verifyOfflineReceipt(args[1], args[2]);
    return;
  }
  assert.equal(args[0], "--live", "lifecycle_verifier_mode_required:--offline|--live");
  await verifyLiveReceipt();
}

export { validateApplyMissionCompletion, validateReceipt, verifyOfflineReceipt };

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
