---
name: Mission approval receipt fail-closed
description: What happens when an approved Mission plan's receipt or revision changes after dispatch.
---

The decision-trace loader itself rejects a changed approval receipt (revoked state, changed approver/event pointer/plan revision, or a changed APPROVED event reference) with a `MissionDecisionTraceStoreError`; outcome finalization therefore throws and writes no snapshot, rather than storing an INCONCLUSIVE one. A changed active plan revision returns `not_ready: plan_not_current`. The evaluator's `approval_binding_mismatch` limitation is only a second guard behind that loader.

**Why:** Tests expecting an INCONCLUSIVE snapshot for tampered approvals fail; the real boundary is earlier and stricter.

**How to apply:** Assert rejection codes and the absence of snapshots and final lifecycle events; recovery counts the decision as unreconciled.
