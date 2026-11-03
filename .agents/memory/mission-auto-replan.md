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