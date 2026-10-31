const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function buildLifecycleStateCensusSql(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new Error("lifecycle_project_root_missing");
  }
  return `
WITH target_project AS (
  SELECT id
  FROM projects
  WHERE root_path = :'project_root'
)
SELECT jsonb_build_object(
  'projectId', (SELECT id FROM target_project),
  'missions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'status', status) ORDER BY id)
    FROM ai_missions
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb),
  'goals', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'missionId', mission_id, 'status', status) ORDER BY id)
    FROM ai_goals
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb),
  'tasks', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'goalId', goal_id, 'status', status,
      'workerId', worker_id, 'leaseUntil', lease_until
    ) ORDER BY id)
    FROM tasks
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb),
  'executions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'goalId', goal_id, 'taskId', linked_task_id,
      'proposalId', proposal_id, 'status', status,
      'workerId', worker_id, 'leaseUntil', lease_until
    ) ORDER BY id)
    FROM ai_executions
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb),
  'proposals', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'status', status, 'lifecycle', lifecycle,
      'operationId', operation_id, 'commitHash', commit_hash,
      'committedTreeHash', committed_tree_hash
    ) ORDER BY id)
    FROM ai_change_proposals
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb),
  'acceptances', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'executionId', execution_id, 'attempt', attempt,
      'terminalStatus', terminal_status, 'outcome', outcome,
      'reasonCode', reason_code, 'nextActionCode', next_action_code,
      'evidenceRequired', evidence_required,
      'evidenceComplete', evidence_complete, 'resumable', resumable
    ) ORDER BY id)
    FROM ai_execution_acceptances
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb),
  'lineages', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'applyMissionId', apply_mission_id,
      'canonicalMissionId', canonical_mission_id,
      'sourceExecutionId', source_execution_id,
      'sourceGoalId', source_goal_id,
      'sourceAcceptanceId', source_acceptance_id,
      'proposalId', proposal_id
    ) ORDER BY apply_mission_id)
    FROM ai_mission_lineages
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb),
  'applyJournal', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'operationId', operation_id, 'attemptId', attempt_id,
      'proposalId', proposal_id, 'stage', stage, 'sequence', sequence
    ) ORDER BY operation_id, attempt_id, sequence)
    FROM ai_apply_journal
    WHERE project_id IN (SELECT id FROM target_project)
  ), '[]'::jsonb)
)::text;
`.trim();
}

export function summarizeLifecycleStateCensus(census) {
  if (!census || typeof census !== "object" || Array.isArray(census)) {
    throw new Error("lifecycle_state_census_invalid");
  }
  for (const key of [
    "missions",
    "goals",
    "tasks",
    "executions",
    "proposals",
    "acceptances",
    "lineages",
    "applyJournal",
  ]) {
    if (!Array.isArray(census[key])) {
      throw new Error(`lifecycle_state_census_${key}_invalid`);
    }
  }

  const nonterminal = Object.fromEntries(
    ["missions", "goals", "tasks", "executions"].map((key) => [
      key,
      census[key]
        .filter((row) => !TERMINAL_STATUSES.has(row?.status))
        .map(({ id, status }) => ({ id, status })),
    ]),
  );
  const staleWorkerLeases = ["tasks", "executions"].flatMap((key) =>
    census[key]
      .filter((row) =>
        TERMINAL_STATUSES.has(row?.status)
        && (row.workerId != null || row.leaseUntil != null),
      )
      .map(({ id, status }) => ({ kind: key, id, status })),
  );
  const hasProjectAndGoal =
    typeof census.projectId === "string"
    && census.projectId.length > 0
    && census.missions.length > 0
    && census.goals.length > 0;

  return {
    ...census,
    assessment: {
      hasProjectAndGoal,
      nonterminal,
      staleWorkerLeases,
      allWorkTerminal:
        hasProjectAndGoal
        && Object.values(nonterminal).every((rows) => rows.length === 0)
        && staleWorkerLeases.length === 0,
    },
  };
}
