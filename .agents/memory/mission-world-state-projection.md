---
name: Mission world-state projection
description: Durable projection contract for Mission facts, unknowns, effects, and proof obligations.
---

Mission execution state should be represented as a bounded server-owned projection with facts, hypotheses, unknowns, contradictions, observations, actions, effects, and proof obligations. Preserve the same projection through checkpoints, execution receipts, and Goal acceptance.

**Why:** Provider responses and transient stream events are not durable world state; recovery and dashboard reloads need one authoritative projection.

**How to apply:** Update the projection from accepted tool/evidence state, cap all lists and text, bind revisions/candidate identity, and never let model prose set terminal proof or authorization.