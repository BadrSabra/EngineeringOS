---
name: Automatic Mission replan
description: Constraints for closed-loop recovery after a Mission Goal enters needs_replan.
---

Automatic replan must run after terminal acceptance commits, under a Mission row lock, and must create a new server-owned plan revision before dispatching only its dependency roots. The active revision is recorded on the Mission so historical Goals cannot poison current status, and stale revisions cannot be dispatched. When an acceptance includes a `FailureDiagnosisSummary`, validate the strict server-owned codes; malformed, approval-required, or non-retryable diagnoses fail closed. Objective evidence recovery is limited to retryable `MISSING_REQUIRED_READ` and `EVIDENCE_INCOMPLETE`. Missing summaries remain a legacy compatibility path.

**Why:** Replanning inside the acceptance transaction risks deadlocks and makes terminal failure durability depend on planner/provider work. Including historical failed Goals in current status also causes every successful replan to fall back to needs_replan. Provider prose and malformed persisted JSON must not decide whether new recovery runs, while older Missions without summaries must remain recoverable.

**How to apply:** Use the durable reconciliation loop as the recovery trigger, preserve old Goal/Task/Execution rows, enforce a bounded automatic-replan budget, and terminalize exhausted, empty, or undispatchable replans as operator-visible `blocked` with an auditable event. Never let diagnosis text add scope or mutation authority; keep Mission revision, evidence, and approval gates authoritative.

Decision traces for automatic replan must preserve the failed Goal, source Execution, and source Acceptance as the decision identity while linking plan application and later dispatch/acceptance to successor Goals through the same Mission and applied plan revision. Persist the trace and `PLAN_APPLIED` event through caller-owned transaction helpers with plan materialization; the trace store is provenance, not dispatch authority or proof.

**Why:** Automatic replan materializes new Goal IDs, so reusing the failed source Goal as the plan/execution target rejects valid successors or risks misbinding a later execution to the failure record. Revision membership narrows the linkage but does not by itself prove an accepted outcome. Calling a wrapper that opens its own transaction from inside plan materialization would also break atomic rollback.

**How to apply:** Keep source evidence checks on the failed Goal/attempt; validate applied-plan Goal membership within Mission/project and validate dispatch/acceptance through the referenced successor execution and its plan revision. Use the transaction-scoped helpers when composing with an existing Mission transaction. If a consumer needs one exact successor Goal, persist and verify an explicit target-ID binding rather than inferring it from the revision.

For live recovery strategy selection, persist bounded structural projections for every candidate and compare those projections; candidate names or utility differences alone do not prove a genuine alternative. If fewer than two eligible plans differ in actions, dependencies, or required observation order, fail closed instead of selecting between labels.

**Why:** A runtime diagnosis with one observation produced identical plans for “direct-status-first” and “transition-provenance-first”; reporting two candidates overstated the available choice.

**How to apply:** Include the actual observation sequence and action/dependency projection in the server-owned decision snapshot, and add a regression test for the identical-plan case before widening strategy coverage.

For approval-required plans, recovery may dispatch only after reloading the complete durable approval receipt, the selected strategy, the active Mission, and its exact applied revision. Route each dependency root through the shared Goal lifecycle, then persist the root run statuses and exact Execution identities with the dispatch event. A partial batch is dispatch provenance only, never Canonical Proof. A process-local cooldown is load shedding, not a distributed lease or restart fence.

**Why:** A crash can occur after final approval and plan application but before root dispatch. Recovery must close that gap without treating approval as execution proof or claiming exactly-once behavior from an in-memory timer.

**How to apply:** Revalidate approval and revision at recovery time, preserve the existing Mission/Goal and task/recipe execution idempotency boundaries, and record a batch only under the existing store contract. When root executions are incomplete, keep the persisted per-root status explicit and do not advance outcome/acceptance proof.

Automatic replanning must materialize the new revision and activate that revision in the same transaction before dispatching its roots. The normal active-plan revision check then rejects historical Goals; do not broadly bypass the `needs_replan` continuation guard. Because a process can stop after activation but before root enqueue, the durable reconciler must rediscover queued `mission_replan_step` roots for the exact active revision.

**Why:** Leaving the Mission in `needs_replan` makes the normal Goal gate reject the new roots. Activating the exact new revision preserves the stale-plan fence, while queued-root recovery closes the crash window introduced by activating before dispatch.

**How to apply:** Keep plan materialization and the active revision/status transition atomic. Recovery may enqueue only dependency-free roots whose revision still equals the Mission's active revision; all normal dependency, approval, and proof gates remain authoritative.

If a live root-dispatch call throws after activation, restore `needs_replan`
only while the Mission still names that exact active revision. A process crash
does not run this recovery path and must leave the active revision available
for queued-root rediscovery.

**Why:** A handled dispatch failure should be retryable, while an unconditional
status rollback could invalidate roots already queued for the active revision.
Crash recovery remains a separate responsibility of the durable reconciler.

**How to apply:** Fence the status update by Mission and active revision, and
keep the existing exact-revision queued-root recovery for process interruption.