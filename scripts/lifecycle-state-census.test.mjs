import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLifecycleStateCensusSql,
  summarizeLifecycleStateCensus,
} from "./lifecycle-state-census.mjs";

test("census query is project-root scoped and excludes prompts and evidence payloads", () => {
  const sql = buildLifecycleStateCensusSql("/tmp/lifecycle-project");
  assert.match(sql, /WHERE root_path = :'project_root'/);
  assert.match(sql, /FROM ai_missions/);
  assert.match(sql, /FROM ai_goals/);
  assert.match(sql, /FROM tasks/);
  assert.match(sql, /FROM ai_executions/);
  assert.match(sql, /FROM ai_change_proposals/);
  assert.match(sql, /FROM ai_execution_acceptances/);
  assert.match(sql, /FROM ai_mission_lineages/);
  assert.match(sql, /FROM ai_apply_journal/);
  assert.doesNotMatch(sql, /request|prompt|agent_response|checkpoint|payload|error/i);
});

test("census refuses an absent project root", () => {
  assert.throws(() => buildLifecycleStateCensusSql(""), /project_root_missing/);
});

test("terminal work with cleared worker leases passes the census", () => {
  const census = summarizeLifecycleStateCensus({
    projectId: "project-1",
    missions: [{ id: "mission-1", status: "completed" }],
    goals: [{ id: "goal-1", status: "completed" }],
    tasks: [{ id: "task-1", status: "completed", workerId: null, leaseUntil: null }],
    executions: [{ id: "execution-1", status: "completed", workerId: null, leaseUntil: null }],
    proposals: [{ id: "proposal-1", status: "applied", lifecycle: "committed" }],
    acceptances: [{ id: "acceptance-1", outcome: "PROVEN" }],
    lineages: [{ applyMissionId: "apply-mission-1", proposalId: "proposal-1" }],
    applyJournal: [{ id: "journal-1", stage: "committed" }],
  });
  assert.equal(census.assessment.allWorkTerminal, true);
  assert.deepEqual(census.assessment.nonterminal, {
    missions: [],
    goals: [],
    tasks: [],
    executions: [],
  });
});

test("nonterminal goals and stale leases block the census", () => {
  const census = summarizeLifecycleStateCensus({
    projectId: "project-1",
    missions: [{ id: "mission-1", status: "active" }],
    goals: [{ id: "goal-1", status: "needs_replan" }],
    tasks: [{ id: "task-1", status: "completed", workerId: "worker-1", leaseUntil: null }],
    executions: [{ id: "execution-1", status: "running", workerId: "worker-2", leaseUntil: "2099-01-01" }],
    proposals: [{ id: "proposal-1", status: "pending", lifecycle: "proposed" }],
    acceptances: [{ id: "acceptance-1", outcome: "INCOMPLETE" }],
    lineages: [],
    applyJournal: [],
  });
  assert.equal(census.assessment.allWorkTerminal, false);
  assert.equal(census.assessment.nonterminal.goals[0]?.status, "needs_replan");
  assert.equal(census.assessment.nonterminal.executions[0]?.status, "running");
  assert.deepEqual(census.assessment.staleWorkerLeases, [
    { kind: "tasks", id: "task-1", status: "completed" },
  ]);
});

test("missing project or goal rows cannot be counted as a successful census", () => {
  const census = summarizeLifecycleStateCensus({
    projectId: null,
    missions: [],
    goals: [],
    tasks: [],
    executions: [],
    proposals: [],
    acceptances: [],
    lineages: [],
    applyJournal: [],
  });
  assert.equal(census.assessment.hasProjectAndGoal, false);
  assert.equal(census.assessment.allWorkTerminal, false);
});
