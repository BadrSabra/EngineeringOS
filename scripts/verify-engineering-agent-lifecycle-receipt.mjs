import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lifecycleSentence =
  "Lifecycle acceptance sentinel: retained after approved delivery.";
const receiptKeys = new Set(["schemaVersion", "status", "stage", "code", "chain"]);
const chainKeys = new Set([
  "projectId",
  "sessionId",
  "userMessageId",
  "userMessageHash",
  "handoffPlanHash",
  "sourceMissionId",
  "sourceGoalId",
  "sourceExecutionId",
  "sourceAttempt",
  "acceptanceId",
  "proposalId",
  "proposalRevision",
  "candidateTreeHash",
  "applyMissionId",
  "applyGoalId",
  "applyExecutionId",
  "commitHash",
  "remoteCommitHash",
  "branch",
  "finalMissionId",
  "engineeringAgentState",
  "activeMissionIdAfterReload",
]);

function hasOnlyKeys(value, allowedKeys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}_must_be_object`);
  for (const key of Object.keys(value)) {
    assert.ok(allowedKeys.has(key), `${label}_has_unexpected_key:${key}`);
  }
}

function validateReceipt(value) {
  hasOnlyKeys(value, receiptKeys, "receipt");
  for (const required of ["schemaVersion", "status"]) {
    assert.ok(Object.hasOwn(value, required), `receipt_missing_${required}`);
  }
  assert.equal(value.schemaVersion, 1, "receipt_schema_version_invalid");
  assert.equal(value.status, "passed", `receipt_not_passed:${value.stage ?? "unknown"}`);
  for (const required of ["stage", "chain"]) {
    assert.ok(Object.hasOwn(value, required), `receipt_missing_${required}`);
  }
  assert.equal(value.stage, "complete", "receipt_stage_not_complete");
  assert.equal(Object.hasOwn(value, "code"), false, "passed_receipt_must_not_have_failure_code");
  hasOnlyKeys(value.chain, chainKeys, "chain");

  const requiredStringKeys = [
    "projectId",
    "sessionId",
    "userMessageId",
    "userMessageHash",
    "handoffPlanHash",
    "sourceMissionId",
    "sourceGoalId",
    "sourceExecutionId",
    "acceptanceId",
    "proposalId",
    "candidateTreeHash",
    "applyMissionId",
    "applyGoalId",
    "applyExecutionId",
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
    "sourceGoalId",
    "sourceExecutionId",
    "acceptanceId",
    "proposalId",
    "applyMissionId",
    "applyGoalId",
    "applyExecutionId",
    "finalMissionId",
    "activeMissionIdAfterReload",
  ]) {
    assert.match(value.chain[key], /^[A-Za-z0-9_-]{1,160}$/, `chain_${key}_invalid`);
  }
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
      'sourceExecution', (SELECT to_jsonb(e) FROM ai_executions e WHERE e.id = ${ids.sourceExecutionId}),
      'sourceAcceptances', COALESCE((
        SELECT json_agg(to_jsonb(a))
        FROM ai_execution_acceptances a
        WHERE a.execution_id = ${ids.sourceExecutionId}
          AND a.attempt = ${Number(chain.sourceAttempt)}
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
      'applyGoal', (SELECT to_jsonb(g) FROM ai_goals g WHERE g.id = ${ids.applyGoalId}),
      'applyExecution', (SELECT to_jsonb(e) FROM ai_executions e WHERE e.id = ${ids.applyExecutionId})
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
  const sourceExecution = requireRow("sourceExecution");
  const proposal = requireRow("proposal");
  const proposalMessage = requireRow("proposalMessage");
  const applyMission = requireRow("applyMission");
  const applyGoal = requireRow("applyGoal");
  const applyExecution = requireRow("applyExecution");

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
  requireValue(
    proposalValidationEvidence[0].candidateIdentity,
    sourceAcceptance.candidateIdentity,
    "proposal_source_candidate_identity",
  );
  requireValue(
    proposalValidationEvidence[0].candidateTreeHash,
    chain.candidateTreeHash,
    "proposal_validation_candidate_tree_hash",
  );
  requireValue(
    proposalValidationEvidence[0].changeSetHash,
    proposal.change_set_hash,
    "proposal_validation_change_set_hash",
  );
  assert.ok(typeof proposal.applied_changes === "string" && proposal.applied_changes.length > 0);
  requireValue(proposalMessage.session_id, chain.sessionId, "proposal_message_session");
  requireValue(proposalMessage.role, "assistant", "proposal_message_role");

  requireValue(applyMission.project_id, chain.projectId, "apply_mission_project");
  requireValue(applyMission.status, "completed", "apply_mission_status");
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
  requireValue(applyGoal.mission_id, chain.applyMissionId, "apply_goal_mission");
  requireValue(applyGoal.project_id, chain.projectId, "apply_goal_project");
  requireValue(applyGoal.status, "completed", "apply_goal_status");
  requireValue(applyExecution.project_id, chain.projectId, "apply_execution_project");
  requireValue(applyExecution.goal_id, chain.applyGoalId, "apply_execution_goal");
  requireValue(applyExecution.status, "completed", "apply_execution_status");
  const applyAcceptance = getAtPath(applyGoal.outcome_contract, "acceptance");
  requireValue(applyAcceptance?.executionId, chain.applyExecutionId, "apply_acceptance_execution");
  requireValue(applyAcceptance?.verdict, "PROVEN", "apply_acceptance_verdict");
}

async function main() {
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

  const receipt = validateReceipt(JSON.parse(await readFile(receiptPath, "utf8")));
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
  verifyDatabaseSnapshot(snapshot, chain);
  console.log(
    "Lifecycle receipt verified: durable Chat/Mission/proof/approval/apply links and the local bare-remote commit match.",
  );
}

export { validateReceipt };

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
