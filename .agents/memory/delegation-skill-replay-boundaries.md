---
name: Delegation and skill replay boundaries
description: Durable design constraints for Mission delegation envelopes and proof-carrying skill candidate shadow replay.
---

Mission delegation is a server-owned, versioned envelope bound to the Mission, Goal, optional Task, owner, plan revision, and dispatch trigger. The first implementation may carry it through the existing Goal/Execution dispatch and event payloads; it must not reuse `parentGoalId` as lineage or prerequisite dependency rows as a delegation graph.

**Why:** The existing Mission runtime already owns dispatch, leases, recovery, and acceptance. A second delegation scheduler or durable execution state machine would create competing authority and make recovery ambiguous.

**How to apply:** Validate the envelope against rows locked by `runMissionGoal`; rebuild it during queued recipe recovery; create a separate entity only if a future requirement needs delegation requests to outlive the existing Goal/Execution lifecycle.

Skill candidates are strict, versioned, source/tree/path-bound envelopes. Shadow replay accepts only the fixed `candidate.verify` contract and a PROVEN, source-bound, candidate-bound execution proof; the replay receipt is disposable and explicitly `productionExecution: false`.

**Why:** Proof demonstrates the verified candidate but does not grant production execution, promotion, delivery, mutation, browser effects, arbitrary recipes, or arbitrary paths.

**How to apply:** Keep validation fail-closed, use server-owned approved paths and tree identities, and route any future promotion through the existing proposal lifecycle and consent gates.