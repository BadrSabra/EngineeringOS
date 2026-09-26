---
name: World State failure diagnosis
description: Bound World State diagnoses to the exact accepted transition without merging diagnosis into acceptance or authorization.
---

For the scoped `runtime.start` pilot, derive diagnosis only from the persisted accepted `WorldTransition` and its exact linked observation rows. Persist diagnosis beside, not inside, Gate C acceptance. Replan context may carry the bounded reason, affected fact refs, evidence IDs, hypotheses, and observation codes only as advisory data.

**Why:** D2 proves a transition-scoped dispatch prerequisite; it does not complete the Goal or replace Gate C. Re-reading global World State can invalidate a valid transition because of unrelated changes, while diagnosis text or hypotheses must never grant scope or mutation authority.

**How to apply:** When adding another transition profile, define bounded server-owned assumption, expected-effect, and observation codes; retain only references to its exact evidence; keep approval-required contradictions blocked; and leave normal acceptance and authorization gates authoritative.