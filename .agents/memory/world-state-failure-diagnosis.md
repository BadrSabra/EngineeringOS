---
name: World State failure diagnosis
description: Bound World State diagnoses to the exact accepted transition without merging diagnosis into acceptance or authorization.
---

For `runtime.start`, keep Gate C acceptance authoritative and keep World State diagnosis separate. A diagnosis is transition-bound only when it carries the exact persisted `WorldTransition` identity and linked observation references. Typed pre-transition failures can be stored in the same bounded diagnostic shape without either; do not treat a reason-only diagnosis as transition proof or mutation authority. Replan context may carry bounded reasons, affected fact refs, evidence IDs, hypotheses, and observation codes only as advisory data.

**Why:** D2 proves a transition-scoped dispatch prerequisite; it does not complete the Goal or replace Gate C. The same stored diagnosis shape is used before and after transition selection, so its presence alone does not establish transition provenance. Re-reading global World State can invalidate a valid transition because of unrelated changes, while diagnosis text or hypotheses must never grant scope or mutation authority.

**How to apply:** Classify each persisted diagnosis by its actual transition/observation linkage; keep reason-only cases diagnostic-only. When adding another transition profile, define bounded server-owned assumption, expected-effect, and observation codes; retain only references to its exact evidence; keep approval-required contradictions blocked; and leave normal acceptance and authorization gates authoritative.