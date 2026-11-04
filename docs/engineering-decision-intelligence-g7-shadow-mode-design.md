# EngineeringOS Decision Intelligence — G7 Shadow Mode Design

## Status

**Implemented in code; opt-in and disabled by default.** The implementation and isolated tests exist, but the additive table has not been applied to Development, the scheduler has not been enabled there, and no live shadow cohort has been observed. This is not evidence of strategy improvement.

## Audit findings

- At the initial G7 audit, the Mission strategy engine returned candidate plan projections and a selected strategy; G5 persisted the authoritative decision trace and its lifecycle.
- `ai_mission_decision_traces` represents normal `SELECTED`, `NO_DECISION`, or `BLOCKED` outcomes; its event stream includes approval, plan application, dispatch, execution, and acceptance stages. A shadow result must not be inserted there as a normal selected decision.
- No dedicated Mission strategy-shadow comparison store or runtime path was found at the initial audit.
- The `shadow` projection for Skill Candidates and Shadow Replay are separate features. Neither records a paired comparison of live Mission strategy versus a shadow strategy.

## Required boundary

G7 compares a shadow strategy against the decision already made by the existing Mission planner. The shadow result is observational only:

- It cannot replace the selected strategy or change the plan preview, plan revision, Mission, Goal, Task, approval, dispatch, Execution, Acceptance, or proof state.
- It cannot emit lifecycle events on the authoritative decision trace.
- It cannot call an AI provider or use shadow output as acceptance, verification, or Canonical Proof.
- `NO_DECISION` is a valid shadow result; uncertainty must not fall back into the live plan.
- Failure to compute or persist a shadow record must not fail or delay the authoritative replan.

## Implementation shape

1. **Capture a paired input.** Use the server-validated context already bound to the authoritative decision: project, Mission, Goal, source Execution/attempt, source Acceptance, prior plan revision, project revision, and context hash. Reject stale or mismatched bindings; never infer a new source identity.
2. **Run the shadow evaluator without effects.** Re-evaluate only the alternatives and context already frozen in the trace using the deterministic `evaluateMissionStrategies` contract. This intentionally does not regenerate candidates: G7 isolates evaluation comparison; G3 owns generation quality. There are no provider or tool calls.
3. **Persist in a dedicated sidecar.** `ai_mission_decision_shadow_comparisons` stores a deterministic comparison keyed by decision/context/applied-plan/policy/evaluator identity, the baseline and shadow result, evaluations, pairwise comparisons, and the source identity columns. It does not append to the authoritative event stream.
4. **Isolate shadow failure and recover it durably.** Shadow work is not in the live replan transaction. The bounded reconciler scans `PLAN_APPLIED` events only after the event reference matches the trace's `newPlanRevision`, then revalidates the immutable trace JSON against the stored identity columns. A unique policy/evaluator key and content hash make concurrent retries idempotent. A shadow failure is logged without failing the Mission replan and does not rerun Mission, Goal, or tools.
5. **Keep rollout disabled by default.** The durable job reconciler calls the shadow pass only when the server-side `MISSION_DECISION_SHADOW_MODE=1` flag is set. Client input cannot enable or broaden it. The flag is not enabled in this work.

## Required tests and gate evidence

- Pairing: an isolated DB test binds the row to the trace decision, context hash, source Acceptance/Execution/attempt, and exact applied plan revision.
- Outcome handling: tests exercise deterministic agreement, stale-plan rejection, `BLOCKED`, and `NO_DECISION`; no shadow result authorizes plan changes.
- Idempotency: two concurrent reconciliations create exactly one row; a later replay creates none.
- Side-effect invariant: the test snapshots Mission, Goals, Tasks, dispatch batches, Executions, Acceptances, and lifecycle events around reconciliation. Only the dedicated sidecar row is added.
- Failure isolation: the scheduler defaults off; the reconciler is separate from the live replan transaction.
- Provider isolation: the shadow module has no provider/tool dependency and the focused test path makes no provider request.

Run database-backed tests only on a fresh loopback-only disposable PostgreSQL cluster. Review the additive schema before any Development apply; do not target Production.

## First isolated implementation attempt

- Command: `MISSION_DECISION_TRACE_ONLY=1 pnpm run test:mission-control`.
- Result: **17 passed, 1 failed**.
- The failure was `decision_event_reference_invalid` while the test fixture attempted to append `PLAN_APPLIED`, before the shadow reconciler was invoked.
- Boundary: this does not test or falsify shadow evaluation, persistence, idempotency, or side-effect isolation. It identifies a mismatch between the fixture's asserted applied revision and the authoritative trace/event preconditions. The disposable PostgreSQL cluster shut down after the run.
- Next action: inspect the event-store precondition and repair only the fixture's active-plan binding; do not weaken the event-store guard.
- Second attempt: after adding the successor Goal required by that guard, shadow insertion, revision binding, and the concurrent idempotency assertion passed. The remaining assertion failed because the test compared against a snapshot taken before its own expected `PLAN_APPLIED` event was appended. The reconciler's pre/post state assertion was therefore staged incorrectly; no authoritative-state mutation by the shadow reconciler was observed. The disposable cluster shut down after the run.
- Next action: capture the invariant snapshot after fixture setup (including `PLAN_APPLIED`) and immediately before invoking shadow reconciliation.
- A later typecheck attempt after adding content-hash assertions failed with two `TS2304` diagnostics: `pureComparison` was referenced outside the test scope where it was created. This was a test-code placement error; no test or runtime execution occurred in that attempt. The contract/store code was not implicated.
- Development schema preview: `drizzle-kit push --strict --verbose` showed the intended new shadow table, but also unrelated foreign-key drops/re-adds and a primary-key change on `openrouter_credential_cooldowns`, with Drizzle's explicit data-loss warning. The command stopped at its confirmation because the shell was non-interactive; **no statements were applied**. The full-schema push is unsafe. Next action is a scoped strict preview; proceed only if it contains the reviewed additive shadow table/constraints/indexes and no unrelated DDL. Do not force or accept the broad diff.

## Current implementation and verified boundary

- `buildMissionStrategyShadowComparison` reparses the immutable trace, requires `SELECTED` plus an exact `newPlanRevision`/`PLAN_APPLIED` binding, then runs the formal evaluator at the trace's fixed `decidedAt`. The comparison ID and payload hash are deterministic.
- The API reconciler is bounded, project-scopable, cursor-paged, and uses the existing event journal as its source. It never writes Mission, Goal, Task, approval, dispatch, Execution, Acceptance, or proof rows.
- Verification: API-server typecheck passed; `MISSION_DECISION_TRACE_ONLY=1 pnpm run test:mission-control` passed **19/19** trace-store tests and **1/1** durable-dispatcher test on a fresh loopback-only disposable PostgreSQL cluster. The test runner applied the additive schema only to that temporary database.
- Not done: no Development schema apply, no API workflow restart for this implementation, no shadow flag activation, and no live Mission shadow record. The current outcome is **G7 implementation slice verified; operational shadow cohort still pending**.

## What G7 will and will not establish

Passing these isolated tests establishes the code path's identity binding, persistence, retry behavior, and non-authority. It does **not** establish live shadow-run quality or that the shadow strategy is better. G7 can report eligible comparisons, agreement/divergence, `NO_DECISION`, and failure counts only after a separately authorized Development canary. G9 needs accepted, proof-bound outcomes and a reproducible baseline before claiming improvement.

## Implementation decision

Use the existing durable trace/event journal as the shadow reconciler's work source; do not add a synchronous shadow hook to the live planner or a second outbox. This keeps G7 independent of the successful plan transaction, survives process restart, and leaves the authoritative lifecycle untouched. The implementation verifies the exact `PLAN_APPLIED` event contract and stored input identity. Development activation remains a separate rollout decision.
