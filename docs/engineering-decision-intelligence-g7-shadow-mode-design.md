# EngineeringOS Decision Intelligence — G7 Shadow Mode Design

## Status

**Implemented and schema-ready in Development; scheduler disabled.** The additive sidecar table is applied to Development and empty outside the canary. A one-off synthetic canary was completed on 2026-11-04 and all of its records were removed. The scheduler remains off and requires a server-side single-project UUID allowlist in addition to the mode flag. This is not evidence of strategy improvement.

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
5. **Keep rollout disabled by default and project-scoped.** The durable job reconciler requires `MISSION_DECISION_SHADOW_MODE=1` and a valid server-side `MISSION_DECISION_SHADOW_PROJECT_ID` UUID. Global scheduler ticks process only that one allowlisted project; project-scoped ticks for any other project are rejected. Missing or malformed scope fails closed. The canary set these variables only in its temporary process and did not persist them in Development.

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
- The first scoped-preview invocation was rejected before database access because this installed Drizzle Kit version does not allow `--config` together with command-line schema/filter flags. No comparison or write occurred. The scoped preview must use a dedicated temporary config instead.
- The dedicated scoped preview then listed only the new shadow table, its six foreign keys, and two indexes; it proposed no unrelated table, enum, key, or data change. The strict confirmation remained at “No, abort” and the preview process timed out before confirmation. A read-only Development check afterward still found the shadow table absent and the existing cooldown primary key unchanged.
- Before any scheduler activation, code review found that the global job-reconciliation tick passed no project scope; the feature flag alone could therefore scan every eligible project. The flag is unset, and no shadow rows were written. G7 rollout must require a valid server-side single-project UUID allowlist and reject mismatched project-scoped ticks.
- After that review, the exact scoped Drizzle preview was applied through Drizzle to Development `heliumdb`; it created only the reviewed sidecar table, constraints, and indexes. Read-only inspection confirmed 19 expected columns, 6 foreign keys, 6 check constraints, the primary key and 2 declared indexes, zero rows, and the unchanged `openrouter_credential_cooldowns` primary key. The release-critical `schema:check` passed. Production was not queried or changed.

## Current implementation and verified boundary

- `buildMissionStrategyShadowComparison` reparses the immutable trace, requires `SELECTED` plus an exact `newPlanRevision`/`PLAN_APPLIED` binding, then runs the formal evaluator at the trace's fixed `decidedAt`. The comparison ID and payload hash are deterministic.
- The API reconciler is bounded, project-scopable, cursor-paged, and uses the existing event journal as its source. It never writes Mission, Goal, Task, approval, dispatch, Execution, Acceptance, or proof rows.
- Verification: API-server typecheck passed; `MISSION_DECISION_TRACE_ONLY=1 pnpm run test:mission-control` passed **19/19** trace-store tests and **1/1** durable-dispatcher test on a fresh loopback-only disposable PostgreSQL cluster. The test runner applied the additive schema only to that temporary database.
- Historical pre-canary state: scoped Drizzle apply succeeded and the sidecar was empty. `MISSION_DECISION_SHADOW_MODE` and `MISSION_DECISION_SHADOW_PROJECT_ID` were absent from persistent Development configuration. The API workflow's schema-rollout restart completed without shadow reconciliation or model inference.

## What G7 will and will not establish

Passing these isolated tests and the synthetic Development canary establishes the code path's identity binding, persistence, retry behavior, and non-authority. It does **not** establish live shadow-run quality for real project work or that the shadow strategy is better. G9 needs accepted, proof-bound outcomes and a reproducible baseline before claiming improvement.

## Development canary preflight — 2026-11-04

- Read-only preflight found 11 existing projects, zero decision traces, zero `PLAN_APPLIED` events, zero revision-matched applied traces, and zero sidecar rows. After explicit approval, the canary created a new synthetic project with its own Mission, Goals, Task, Execution, Acceptance, world fact, trace, and matching applied-plan event. No existing project was used.
- The canary process set `MISSION_DECISION_SHADOW_MODE=1` and `MISSION_DECISION_SHADOW_PROJECT_ID` to that one synthetic UUID, verified that a different project UUID was rejected, and called the bounded reconciler with batch size 1. The first call recorded one comparison; a second call recorded zero.
- Verified receipt: project `e9a9d02e-7b99-4749-801a-7ceabcc9d770`; decision `b7c8e4822fa976a316463133c8001fd91104d4caac816c2bae3580c870e97192`; applied plan revision `g7-shadow-applied-7df8305d-8e4e-4c71-be08-b9c9daf2c8aa`; context hash `09aac6c3c1a9dac0fa0517c244bc3974e191bef89f642e9242ec47a29e91f2e0`; `PLAN_APPLIED` event hash `b1461ce8f31c69a1a729b750e22b2684d373a9d4503861f836882cd47ed39a2b`; sidecar comparison hash `2f87414cd5e427f132a0b82b1cd148fa99fe2754476ac68be68ca9062817f7b2`. The outcome was `AGREES` (`safe-read-one` baseline, `SELECTED` shadow).
- Before/after snapshots of the Mission, both Goals, Task, Execution, Acceptance, decision trace, and lifecycle events were identical across reconciliation. `fetch` was blocked during the reconciliation and no network/provider attempt occurred. The deterministic evaluator was used; no provider or tool was called.
- Cleanup deleted the synthetic project and cascaded its fixture rows. A Development read-back confirmed the project, Mission, Goals, Task, Execution, Acceptance, world fact, trace, lifecycle events, and sidecar rows for its UUID were all zero; global Development totals returned to 11 projects, zero traces, zero `PLAN_APPLIED` events, and zero sidecar rows. The process-local flags were removed, the parent environment still had neither flag, and no workflow was restarted.
- The isolated loopback-only `MISSION_DECISION_TRACE_ONLY=1 pnpm run test:mission-control` run also passed: 19 trace-store tests and the focused durable-dispatcher test. The synthetic canary is a controlled path check, not evidence of real-project strategy quality.

## Implementation decision

Use the existing durable trace/event journal as the shadow reconciler's work source; do not add a synchronous shadow hook to the live planner or a second outbox. This keeps G7 independent of the successful plan transaction, survives process restart, and leaves the authoritative lifecycle untouched. The implementation verifies the exact `PLAN_APPLIED` event contract and stored input identity. Development activation remains a separate rollout decision.
