import { execFileSync } from "node:child_process";

function sqlLiteral(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new Error(`Missing bounded ${label} for runtime transition evidence.`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

export function readRuntimeTransitionEvidence({
  databaseUrl,
  missionId,
  projectId,
  runtimeStartGoalId,
  targetGoalId,
}) {
  if (typeof databaseUrl !== "string" || !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    throw new Error("Runtime transition evidence requires the isolated PostgreSQL URL.");
  }
  const mission = sqlLiteral(missionId, "Mission ID");
  const project = sqlLiteral(projectId, "project ID");
  const runtimeGoal = sqlLiteral(runtimeStartGoalId, "runtime-start Goal ID");
  const targetGoal = sqlLiteral(targetGoalId, "target Goal ID");
  const query = `
    SELECT json_build_object(
      'mission', json_build_object(
        'id', m.id,
        'projectId', m.project_id,
        'activePlanRevision', m.autonomy_policy ->> 'activePlanRevision'
      ),
      'runtimeGoal', json_build_object(
        'id', runtime_goal.id,
        'status', runtime_goal.status,
        'stepId', runtime_goal.success_criteria ->> 'stepId'
      ),
      'execution', json_build_object(
        'id', execution.id,
        'status', execution.status,
        'attempt', execution.attempt
      ),
      'acceptance', json_build_object(
        'id', acceptance.id,
        'executionId', acceptance.execution_id,
        'attempt', acceptance.attempt,
        'outcome', acceptance.outcome,
        'evidenceRequired', acceptance.evidence_required,
        'evidenceComplete', acceptance.evidence_complete,
        'evidenceSnapshotId', acceptance.evidence_snapshot_id,
        'effectBundleId', acceptance.effect_bundle_id,
        'sourceRevision', acceptance.source_revision
      ),
      'evidenceSnapshot', json_build_object(
        'id', snapshot.id,
        'executionId', snapshot.execution_id,
        'attempt', snapshot.attempt,
        'complete', snapshot.complete,
        'verdict', snapshot.verdict,
        'sourceRevision', snapshot.source_revision,
        'artifactRefs', snapshot.artifact_refs
      ),
      'transition', json_build_object(
        'id', transition.id,
        'executionId', transition.execution_id,
        'attempt', transition.attempt,
        'episodeId', transition.episode_id,
        'actionId', transition.action_id,
        'effectBundleId', transition.effect_bundle_id,
        'status', transition.status,
        'freshness', transition.freshness,
        'taskScope', transition.task_scope,
        'parentWorldRevision', transition.parent_world_revision,
        'resultingWorldRevision', transition.resulting_world_revision,
        'resultingScopedWorldRevision', transition.resulting_scoped_world_revision,
        'environmentRevision', transition.environment_revision,
        'beforeObservationIds', transition.before_observation_ids,
        'afterObservationIds', transition.after_observation_ids
      ),
      'targetGoal', json_build_object(
        'id', target_goal.id,
        'status', target_goal.status,
        'stepId', target_goal.success_criteria ->> 'stepId'
      ),
      'd2Dispatch', json_build_object(
        'id', dispatch.id,
        'type', dispatch.type,
        'transitionProof', dispatch.payload -> 'transitionProof'
      )
    )::text
    FROM ai_missions m
    JOIN ai_goals runtime_goal
      ON runtime_goal.id = ${runtimeGoal}
     AND runtime_goal.mission_id = m.id
    JOIN ai_executions execution
      ON execution.goal_id = runtime_goal.id
    JOIN ai_execution_acceptances acceptance
      ON acceptance.execution_id = execution.id
     AND acceptance.attempt = execution.attempt
     AND acceptance.outcome = 'SUCCEEDED'
    JOIN ai_execution_evidence_snapshots snapshot
      ON snapshot.id = acceptance.evidence_snapshot_id
    JOIN ai_world_transitions transition
      ON transition.execution_id = execution.id
     AND transition.attempt = acceptance.attempt
    JOIN ai_goals target_goal
      ON target_goal.id = ${targetGoal}
     AND target_goal.mission_id = m.id
    JOIN LATERAL (
      SELECT id, type, payload
      FROM events
      WHERE project_id = m.project_id
        AND goal_id = target_goal.id
        AND type LIKE 'AiGoal%DispatchRequested'
        AND payload -> 'transitionProof' ->> 'transitionId' = transition.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) dispatch ON true
    WHERE m.id = ${mission}
      AND m.project_id = ${project}
    ORDER BY execution.created_at DESC
    LIMIT 1
  `;
  const output = execFileSync(
    "psql",
    [databaseUrl, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", query],
    {
      encoding: "utf8",
      timeout: 15_000,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  if (!output) {
    throw new Error("Durable runtime Gate C, World Transition, or D2 dispatch evidence is missing.");
  }
  return JSON.parse(output);
}
