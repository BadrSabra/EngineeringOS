---
name: Automatic Mission replan
description: Constraints for closed-loop recovery after a Mission Goal enters needs_replan.
---

Automatic replan must run after terminal acceptance commits, under a Mission row lock, and must create a new server-owned plan revision before dispatching only its dependency roots. The active revision is recorded on the Mission so historical Goals cannot poison current status, and stale revisions cannot be dispatched. When an acceptance includes a `FailureDiagnosisSummary`, validate the strict server-owned codes; malformed, approval-required, or non-retryable diagnoses fail closed. Objective evidence recovery is limited to retryable `MISSING_REQUIRED_READ` and `EVIDENCE_INCOMPLETE`. Missing summaries remain a legacy compatibility path.

**Why:** Replanning inside the acceptance transaction risks deadlocks and makes terminal failure durability depend on planner/provider work. Including historical failed Goals in current status also causes every successful replan to fall back to needs_replan. Provider prose and malformed persisted JSON must not decide whether new recovery runs, while older Missions without summaries must remain recoverable.

**How to apply:** Use the durable reconciliation loop as the recovery trigger, preserve old Goal/Task/Execution rows, enforce a bounded automatic-replan budget, and terminalize exhausted, empty, or undispatchable replans as operator-visible `blocked` with an auditable event. Never let diagnosis text add scope or mutation authority; keep Mission revision, evidence, and approval gates authoritative.

Decision traces for automatic replan must preserve the failed Goal, source Execution, and source Acceptance as the decision identity while linking plan application and later dispatch/acceptance to successor Goals through the same Mission and applied plan revision. The trace store is provenance, not dispatch authority or proof.

**Why:** Automatic replan materializes new Goal IDs, so reusing the failed source Goal as the plan/execution target rejects valid successors or risks misbinding a later execution to the failure record. Revision membership narrows the linkage but does not by itself prove an accepted outcome.

**How to apply:** Keep source evidence checks on the failed Goal/attempt; validate applied-plan Goal membership within Mission/project and validate dispatch/acceptance through the referenced successor execution and its plan revision. If a consumer needs one exact successor Goal, persist and verify an explicit target-ID binding rather than inferring it from the revision.