# EngineeringOS Decision Intelligence — G1 Baseline v1

- **Snapshot date:** 2026-11-03
- **Repository revision:** local `main` at `0b67a01`
- **Database target:** Development only; verified by `SELECT current_database(), current_schema(), current_setting('server_version')` as `heliumdb`, `public`, PostgreSQL `16.10`.
- **Read mode:** Replit database callback with `environment: "development"`; every statement was `SELECT` against aggregate/status metadata. No Production query and no write were run.
**Privacy scope:** No Mission intent, prompt, user identity, project ID, task text, or raw candidate JSON was read into the report.

## 1. Population and interpretation

The snapshot uses all current Development rows, not a sampled production cohort:

| Population | Inclusion rule | Snapshot size |
|---|---|---:|
| Missions | All `public.ai_missions` rows | 11 |
| Mission Goals | `ai_goals.mission_id IS NOT NULL` | 23 |
| Mission Tasks | `tasks.goal_id` references one of those Goals | 21 |
| Mission Executions | `ai_executions.goal_id` references one of those Goals | 11 |
| Acceptance attempts | Acceptance rows for those Mission-linked Executions | 12 rows; 11 distinct Executions; 12 distinct `(Execution, attempt)` pairs |
| Episodes | `ai_agent_episodes.mission_id IS NOT NULL` | 8 |
| World Transitions | Transitions for those Mission-linked Executions | 2 |

The Mission rows span 2026-10-20 through 2026-10-22. This is a small, short Development history, and it is not established whether each row is a genuine user workflow, a validation run, or a retained fixture. Therefore the results below are **descriptive Development state**, not a population estimate or a claim about user-facing production success.

The data shows why “Execution completed” cannot be used as a success proxy: all 11 linked Execution rows have status `completed`, while their Acceptance records contain 11 `SUCCEEDED` and one `FAILED` attempt. There are also two successful acceptance attempts whose current Goal status is `verifying`, and one failed attempt whose current Goal status is `completed`. These can represent different attempts or later state transitions; they are not declared defects without the relevant lifecycle contract. They do make cross-layer status joins mandatory before any success claim.

## 2. Observed snapshot

### Mission, Goal, and Task states

| Entity | Observed status or phase | Count |
|---|---|---:|
| Mission | `active` | 4 |
| Mission | `waiting` | 2 |
| Mission | `blocked` | 2 |
| Mission | `needs_replan` | 1 |
| Mission | `completed` | 2 |
| Goal | `queued` | 7 |
| Goal | `running` | 4 |
| Goal | `verifying` | 2 |
| Goal | `needs_replan` | 3 |
| Goal | `completed` | 7 |
| Task | `analyze / verifying` | 4 |
| Task | `deliver / verifying` | 10 |
| Task | `execute / completed` | 1 |
| Task | `inspect / verifying` | 2 |
| Task | `inspect / completed` | 3 |
| Task | `validate / verifying` | 1 |

There are 17 `verifying` Tasks and four `completed` Tasks. One `verifying` Task is attached to a currently completed Goal. The snapshot does not establish whether the Task rows are intended to be independent work items or projections of Goal plan steps. G2 must not count a Goal as a fully completed task until that contract is explicit.

### Execution, Acceptance, replan, and effect evidence

| Measure | Observed value | Scope and limitation |
|---|---:|---|
| Mission-linked Executions with status `completed` | 11/11 | Execution status only; it is not equivalent to acceptance. |
| Mission-linked Acceptance attempts | 12 | 11 unique Executions and 12 unique Execution/attempt pairs. |
| Successful Acceptance attempts | 11/12 (91.7%) | Attempt-level only; 95% Wilson interval: 64.6%–98.5%. The interval is wide because `n=12`. This is not a production success rate. |
| Failed Acceptance attempts | 1/12 | The failed record is `paused` with one required item and zero complete items. |
| Goals with at least one successful Acceptance | 9 | This is a linked count, not a Mission completion rate. |
| Attempts per accepted Goal | Mean 1.33; median 1; `n=9` Goals | Counts distinct `(Execution, attempt)` pairs on Goals that have a successful Acceptance. Includes prior failed attempts. |
| Goal creation to latest successful Acceptance | Mean 5.13 seconds; median 2.654 seconds; `n=9` Goals | Database interval only; small Development sample and not end-to-end user latency. |
| Mission-related `AiMissionReplanBlocked` events | 2 | Both between 2026-10-21 and 2026-10-21; no successful automatic-replan event was found in this event snapshot. |
| Fresh, materialized Mission-linked World Transitions | 2 | No Mission-strategy outcome or contradiction metric is implied. |
| Approval-granted events | 1 | No eligible-task denominator; not an intervention rate. |

Acceptance evidence counters total 10 required and 11 complete across the 12 attempts. Because “complete” can exceed “required,” a ratio is not meaningful without a contract explaining whether `evidence_complete` includes optional evidence. By the narrow predicate `evidence_complete >= evidence_required`, 11 of 12 rows meet the minimum-count comparison; this is not reported as the definitive evidence-completeness rate.

### Existing strategy and resource records

| Existing subsystem | Development result | Interpretation |
|---|---:|---|
| `ai_strategy_candidates` | 2 rows: one `discovered` candidate with one supporting Mission Episode; one `pending_replay` candidate with two supporting Episodes but no Mission-linked support | Candidate discovery exists, but these rows are not live Mission strategy decisions. |
| `ai_strategy_replay_cases` | 0 | No registered held-out replay cases in this Development snapshot. |
| `ai_strategy_replay_case_runs` | 0 | No replay outcome is available here. |
| Goal snapshots containing `strategyDecision` | 0/23 | No live Mission strategy trace is present in the current Development Goals. |
| Goal snapshots containing `planRevision` | 23/23 | Plan revision identity is present; it is not itself a strategy trace. |
| `ai_usage_events` overall | 121 rows, 85 linked to an Execution | This table contains aggregate provider/model usage. |
| `ai_usage_events` linked to Mission Executions | 0 | Mission-level token/latency/resource per accepted outcome is `NOT MEASURABLE YET`; do not substitute the overall usage total. |

This is a useful architectural discovery: the project already has a separate, proof-bound Strategy Candidate/Replay pipeline. The next implementation should connect the existing Mission strategy path to that infrastructure only through an explicit contract and eligibility gate, rather than add another candidate catalog or replay runner.

## 3. Metric register

Every metric is evaluated against the six required categories: runtime operations, code inspection, code modification, code validation, Git operations, and external service operations. The current Mission Task `phase` values (`analyze`, `deliver`, `execute`, `inspect`, `validate`) do not provide a safe one-to-one mapping to those six categories; `deliver` in particular does not distinguish Git from external service. Until a server-owned category mapping is introduced, category-stratified values are `NOT MEASURABLE YET`.

| # | Metric | Development evidence | Baseline disposition |
|---:|---|---|---|
| 1 | Mission completion rate | 2 of 11 Missions currently `completed`; the remaining rows are mixed non-completed states. | **NOT MEASURABLE YET** as an eligible-cohort rate. Report only the state inventory above. |
| 2 | Goal completion rate | 7 of 23 Goals currently `completed`; other Goals remain queued/running/verifying/replan. | **NOT MEASURABLE YET** as a terminal eligible-cohort rate. |
| 3 | Acceptance rate | 11 successful of 12 recorded Mission-linked acceptance attempts; Wilson 95% interval 64.6%–98.5%. | **MEASURED, descriptive only**; attempt-level, tiny Development sample, not category-stratified. |
| 4 | Failed execution rate | 0/11 Execution rows have status `failed`, but one Acceptance attempt is `FAILED` while its Execution status is `completed`. | **NOT MEASURABLE YET** as a system failure rate until the metric is defined against the acceptance contract. |
| 5 | Automatic replan rate | Two blocked events; no successful automatic replan event in the snapshot. Eligible failure denominator is unavailable. | **NOT MEASURABLE YET**. |
| 6 | Replan success rate | No successful automatic-replan event/outcome pair in this snapshot. | **NOT MEASURABLE YET**. |
| 7 | Repeated failure rate | No stable failure-family population and terminal outcome join defined for this snapshot. | **NOT MEASURABLE YET**. |
| 8 | Strategy repetition after failure | 0/23 current Mission Goal snapshots contain `strategyDecision`; the general strategy candidate table is separate. | **NOT MEASURABLE YET**. |
| 9 | Human intervention rate | One approval-granted event is present; no eligible task denominator or complete intervention event contract. | **NOT MEASURABLE YET**. |
| 10 | Approval-required rate | Approval is a separate gate; one approval event is observed, but eligible decision count is unknown. | **NOT MEASURABLE YET**. |
| 11 | Average execution attempts per accepted task | Mean 1.33, median 1, across nine Goals with a successful Acceptance; attempts count distinct `(Execution, attempt)` pairs. | **MEASURED, descriptive only**; category mapping and representative sample are missing. |
| 12 | Time to accepted completion | Goal creation to latest successful Acceptance: mean 5.13 s, median 2.654 s, nine Goals. | **MEASURED, narrow proxy only**; not end-to-end elapsed time and not representative. |
| 13 | Recovery success rate | Two blocked replans and no linked successful replan outcome in the event snapshot. | **NOT MEASURABLE YET**. |
| 14 | Evidence completeness | 10 required versus 11 complete evidence counters; one failed attempt is 0/1. Counter semantics do not support a valid percentage yet. | **NOT MEASURABLE YET** as a percentage; raw counts retained. |
| 15 | Stale observation rejection rate | No durable denominator/telemetry aggregate for attempted stale reads was identified. | **NOT MEASURABLE YET**. |
| 16 | Contradictory World State detection | Two fresh materialized Transitions; no contradiction-detection outcome or eligible comparison set. | **NOT MEASURABLE YET**. |
| 17 | Duplicate execution prevention | Existing idempotency/lease tests provide behavioral evidence, but Development records do not count attempted duplicate requests. | **NOT MEASURABLE YET** as a production rate. |
| 18 | Resource consumption per accepted outcome | Zero `ai_usage_events` join to Mission-linked Executions. | **NOT MEASURABLE YET**. |

## 4. Reproducibility and missing-data rules

1. Use only Replit’s Development target (`executeSql` with `environment: "development"`).
2. First assert `current_database()`, `current_schema()`, and PostgreSQL version. Stop if the database is not `heliumdb`, schema is not `public`, or the schema differs from the inspected revision.
3. Use the population joins in this report: Mission Goals by `mission_id IS NOT NULL`; Mission Tasks through those Goal IDs; Mission Executions through `goal_id`; Acceptances through those Execution IDs.
4. Re-run the static, aggregate-only queries below. Do not select user, prompt, intent, task description, or raw JSON content.
5. Keep snapshot measures distinct from cohort rates. Non-terminal rows are not silently counted as failures. Approval-required work is not an autonomous failure.
6. Report unavailable values exactly as `NOT MEASURABLE YET`; do not impute zeros, infer category from free-form text, or use test fixture results as historical performance.
7. Any future comparison must pin code revision, database snapshot/window, case IDs, denominator rules, sample size, exclusions, and confidence intervals.

### Read-only SQL used for the core snapshot

Run each statement separately in the Development database:

```sql
SELECT current_database(), current_schema(), current_setting('server_version');

SELECT status, count(*) AS n, min(created_at), max(created_at)
FROM ai_missions
GROUP BY status
ORDER BY status;

SELECT status, count(*) AS n
FROM ai_goals
WHERE mission_id IS NOT NULL
GROUP BY status
ORDER BY status;

SELECT phase, status, count(*) AS n
FROM tasks
WHERE goal_id IN (SELECT id FROM ai_goals WHERE mission_id IS NOT NULL)
GROUP BY phase, status
ORDER BY phase, status;

SELECT status, count(*) AS n, count(*) FILTER (WHERE attempt > 1) AS attempts_over_one
FROM ai_executions
WHERE goal_id IN (SELECT id FROM ai_goals WHERE mission_id IS NOT NULL)
GROUP BY status
ORDER BY status;

SELECT a.outcome, a.terminal_status, a.attempt, count(*) AS acceptance_rows,
       count(DISTINCT a.execution_id) AS executions,
       count(DISTINCT (a.execution_id, a.attempt)) AS execution_attempts
FROM ai_execution_acceptances a
JOIN ai_executions e ON e.id = a.execution_id
JOIN ai_goals g ON g.id = e.goal_id
WHERE g.mission_id IS NOT NULL
GROUP BY a.outcome, a.terminal_status, a.attempt
ORDER BY a.attempt, a.outcome, a.terminal_status;

SELECT type, count(*) AS n
FROM events
WHERE type ILIKE '%Mission%' OR type ILIKE '%Goal%'
GROUP BY type
ORDER BY type;

SELECT evaluation_status, count(*) AS candidates
FROM ai_strategy_candidates
GROUP BY evaluation_status
ORDER BY evaluation_status;

SELECT count(*) AS mission_usage_events
FROM ai_usage_events u
JOIN ai_executions e ON e.id = u.execution_id
JOIN ai_goals g ON g.id = e.goal_id
WHERE g.mission_id IS NOT NULL;
```

## 5. G1 decision

- **G1: COMPLETE as a versioned, reproducible Development snapshot with explicit missing-data states.**
- **Statistical evidence of Mission strategy improvement: NOT ESTABLISHED.**
**Category-stratified Decision Intelligence baseline: NOT MEASURABLE YET.**

This clears the baseline-definition gate, not the quality or improvement gate. The baseline cannot support claims that the system is reliable across task categories or that a selected strategy improves outcomes. G2 has defined shared contracts. G3 includes both isolated proposal generation/differentiation and an older, live, narrowly scoped auto-replan strategy engine whose selected runtime strategy is proven to alter a materialized plan; its two recovery families and heuristic scoring are not the broader formal Decision Intelligence pipeline. G4's formal 15-dimension evaluator is tested in isolation, while the live engine uses its own fixed heuristic ranking. G5 has a standalone trace persistence layer without live Mission integration, and the Development snapshot's 0/23 strategyDecision count remains a historical data fact, not proof that the current code lacks a live strategy path. None backfills historical traces or makes outcomes measurable. G6 must establish trustworthy source-to-successor outcome joining, and G9 improvement claims must continue to preserve `NOT MEASURABLE YET` until new, traceable outcomes exist.
