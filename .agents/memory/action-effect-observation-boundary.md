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

Candidate validation is a read-only action but still uses the same effect spine: a server-owned
validation result is observed as a state transition only when paired with fresh direct before/after
observations; the read-only World State projection may be deferred until after effect acceptance.

**Why:** Validation does not mutate the candidate, but it makes a claim about candidate state that
must not be accepted from a receipt or provider result alone. Keeping the projection out of the
gate also avoids making a derived read model a second acceptance authority.

**How to apply:** For `candidate.verify`, persist action request/commit events, materialize direct
workspace/status observations, classify the effect before terminal acceptance, and pass the bound
effect bundle through the existing completion finalizer.

Gate C follows the same seam for Browser and Delivery recipe nodes: profile/session/source
revision and remote commit/parent/tree/operation-marker metadata must come from server-owned
observers, then be materialized as fresh direct after-state evidence before acceptance.

**Why:** A browser receipt or a local push result can be valid while the served revision or remote
branch has drifted. Independent after-state identity checks prevent those records from becoming
false causal proof.

**How to apply:** Runtime observers must fence session, revision, worker lease, PID, port, health,
and marker; delivery observers must re-read remote branch state after push, including idempotent
reconciliation. Keep runtime action wiring and reconnect coverage separate until they are proven.