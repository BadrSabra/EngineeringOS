---
name: Action effect evidence boundary
description: Durable rules for binding mutation actions to independent before/after observations and acceptance proof.
---

Mutation-backed acceptance must stay separate from runtime effect observation. An action carries its
episode, capability, preconditions, expected effects, authorization, and idempotency identity. The
effect verifier may classify an effect only from server-materialized observations that are
DIRECT_OBSERVATION, complete, and fresh for the same project, execution, attempt, and episode.
Acceptance, validator receipts, delivery receipts, world-state projections, and model output remain
server-owned evidence or hypotheses; none can be relabeled as an independent runtime observation.

**Why:** A successful provider call or terminal acceptance can describe what the system decided, but
cannot establish that a mutation changed the external world. Allowing those records to close an
effect would make causal credit and PROVEN status vulnerable to false positives.

**How to apply:** Keep effect bundles append-only and identity-bound, link them to acceptance only
through the existing acceptance row, and require every effect in a mutation-required bundle to be
`observed` before a successful acceptance can become PROVEN. Missing, stale, contradictory, or
unchanged before/after evidence must remain non-PROVEN.