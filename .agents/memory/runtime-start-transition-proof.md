---
name: Runtime start transition proof
description: Proof boundaries for the first P6 runtime.start World Transition.
---

For the initial P6 `runtime.start` slice:

- Preserve the existing Gate C acceptance path. World State materialization is derived post-acceptance work; failure must leave an explicit transition status and must not retroactively downgrade accepted execution.
- The runtime manager's `get()` is a local/persisted snapshot, not independent proof. Never treat a runtime row or `pid: null` alone as evidence that a runtime is absent.
- Materialize only exact observation IDs linked to the transition. The broad World State materializer can include unrelated project observations.
- During the parent revision check, exclude only the current transition Episode's newly recorded evidence; the resulting revision still represents the full projection.
- Keep `restart` and `stop` outside the first slice.

**Why:** P6 needs independent before/after observations, a durable Wn→Wn+1 transition, and a later decision that consumes Wn+1. A receipt or synthetic `pending` value cannot establish the runtime effect.

**Why:** Runtime evidence must be durably recorded before projection, which advances the global observation-based revision even though the decision's parent facts have not changed.

**How to apply:** Add a separate, attempt-bound transition around `runtime.start`; require current direct before/after evidence before materialization, and preserve the existing acceptance result when transition materialization fails. Compare the parent while omitting only that Episode's new evidence, then store the full resulting revision.

For the first pilot, count only a server-authorized `stopped → running` event.
An idempotent `running → running` result may satisfy an ordinary ensure-running
Goal, but it is not a P6 transition and cannot admit a successor that requires
the start event. D1 must consume the exact parent `Wn` and match it with the
independent direct pre-state before the effect; `ACTION_REQUESTED` is intent,
not D1 approval.

D2 is a separate, plan-bound successor-dispatch decision, not Goal completion
or Canonical Proof. Bind one source step to one target step with stable step IDs
inside the hashed server-owned plan, then resolve those IDs to Goal IDs during
materialization. Keep `ai_goal_dependencies` semantics limited to predecessor
completion. Evaluate D2 with the locked Mission dispatch transaction and bind
the result to the exact transition, execution attempt, Episode, observations,
environment revision, and active plan revision. Treat that transaction commit
as the authorization point; later replans do not retroactively cancel an
already authorized dispatch unless a separate fencing/revocation protocol is
designed.

`materialized` alone is not sufficient evidence for this pilot: direct
before/after observations must identify the same runtime session and the same
environment revision, not merely share a freshness label. Event-based D2 should
consume the exact transition-linked observation refs rather than require the
whole project's current revision to remain unchanged; require a current-state
check only when the target Goal explicitly needs current state.

**Why:** Ordinary execution acceptance can remain valid when World State
materialization fails, and an idempotent start can succeed without causing a
transition. A global projection revision, freshness booleans, or a Goal
completion edge cannot prove the causal, session-scoped event needed by a
specific successor.

**How to apply:** Keep the initial pilot to `runtime.start`; test unavailable
or conflicting D1 evidence, already-running no-op, mismatched session or
environment evidence, wrong source/target plan binding, stale plan revision,
and failed/unmaterialized transitions. Do not add a generic predicate language,
dependency graph, scheduler, restart/stop pilot, or P7/P7.5 work as part of this
closure.