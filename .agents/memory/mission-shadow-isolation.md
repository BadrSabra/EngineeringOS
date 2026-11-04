---
name: Mission strategy shadow isolation
description: G7 shadow comparisons must not participate in live Mission plan transactions or authority lifecycle.
---

Mission strategy shadow work should be recovered from the durable authoritative decision trace after `PLAN_APPLIED` and stored in a separate idempotent sidecar. Do not add a shadow write to the live replan transaction or emit authoritative lifecycle events from shadow evaluation.

Scheduler activation must also require a valid server-side single-project UUID allowlist; a mode flag alone must never enable a global shadow scan.

**Why:** `autoReplanMission` persists the authoritative trace and mutates plan state in one transaction; a shadow failure in that transaction could roll back valid work. The durable trace/event journal already survives process restarts and binds the baseline decision.

**How to apply:** Reconcile only immutable, sufficiently captured trace inputs for the allowlisted project. Reject other project-scoped ticks. Use `NO_DECISION` when those inputs cannot support evaluation; retry sidecar failures without rerunning Mission/Goal/tools or changing the live decision.
