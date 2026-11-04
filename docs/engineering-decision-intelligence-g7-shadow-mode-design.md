# EngineeringOS Decision Intelligence — G7 Shadow Mode Design

## Status

**Design only; G7 is not implemented or enabled.** This record follows the G7 code audit and defines the safety boundary for implementation. It is not evidence of shadow-run quality or product improvement.

## Audit findings

- The Mission strategy engine returns candidate plan projections and a selected strategy. G5 persists the authoritative decision trace and its lifecycle.
- `ai_mission_decision_traces` represents normal `SELECTED`, `NO_DECISION`, or `BLOCKED` outcomes; its event stream includes approval, plan application, dispatch, execution, and acceptance stages. A shadow result must not be inserted there as a normal selected decision.
- No dedicated Mission strategy-shadow comparison store or runtime path was found.
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
2. **Run the shadow engine without effects.** Reuse the existing bounded strategy-generation and evaluation contracts, but keep the shadow result separate from the selected plan projection. Use deterministic, server-owned rules in the first G7 implementation; no provider calls.
3. **Persist in a dedicated sidecar.** Add a separate append-only comparison record keyed by a deterministic hash of the baseline decision, context hash, strategy policy version, and evaluator version. Store the baseline strategy ID, shadow `SELECTED`/`NO_DECISION`/`BLOCKED` result, shadow strategy ID when selected, candidate/evaluation hashes, and source identity/revisions. Do not append shadow rows to the authoritative decision-event stream.
4. **Isolate shadow failure and recover it durably.** Do not insert shadow work in the live replan transaction: `autoReplanMission` currently persists the authoritative trace and changes plan state inside one transaction, so a shadow write failure there could abort valid work. Use the durable authoritative trace/event journal as the pending-work source after `PLAN_APPLIED`, and add a separate idempotent shadow sidecar. A failed comparison leaves that source eligible for a later bounded retry; it does not rerun the Mission, Goal, or tools. If the persisted trace does not contain enough immutable input for the selected shadow policy, record `NO_DECISION` rather than reloading mutable context as if it were the original snapshot.
5. **Keep rollout disabled by default.** Enable only in isolated tests first. Any future development canary requires an explicit server-side flag; client input cannot enable or broaden it.

## Required tests and gate evidence

- Pairing: shadow row binds the exact authoritative decision, context hash, source Acceptance/Execution/attempt, and plan revision.
- Distinctness: fixtures demonstrate both a shadow strategy differing from the baseline and a typed `NO_DECISION`; do not count duplicated candidate lists as strategy diversity.
- Idempotency: retrying the same source/context/policy creates no duplicate row; a different source attempt or context produces a distinct identity.
- Fail-closed identity: stale plan, cross-project source, mismatched Acceptance, or changed attempt cannot be rebound to a current Mission.
- Side-effect invariant: compare before/after state for Mission/Goal plans and revisions, approvals, Tasks, dispatch batches/events, Executions, Acceptances, and proof records. Only the dedicated shadow record may be added.
- Failure isolation: generator, evaluator, or sidecar-write failure cannot change the authoritative strategy or abort its plan update.
- Provider isolation: the shadow path uses no network/provider invocation.

Run database-backed tests only on a fresh loopback-only disposable PostgreSQL cluster. Review the additive schema before any Development apply; do not target Production.

## What G7 will and will not establish

Passing these tests establishes that shadow comparisons are paired, durable, bounded, and non-authoritative. It does **not** establish that the shadow strategy is better. G7 metrics may report eligible comparisons, agreement/divergence, `NO_DECISION`, and failure counts, but G9 needs accepted, proof-bound outcomes and a reproducible baseline before claiming improvement.

## Implementation decision

Use the existing durable trace/event journal as the shadow reconciler's work source; do not add a synchronous shadow hook to the live planner or a second outbox. This keeps G7 independent of the successful plan transaction, survives process restart, and leaves the authoritative lifecycle untouched. The implementation must verify the exact `PLAN_APPLIED` event contract and input sufficiency before enabling any comparison.
