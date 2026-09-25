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

New episode-backed `ACTION_REQUESTED` writes must persist the canonical `AgentAction` and derive
episode action/effect references from it. Keep historical reduced strategy projections readable;
when an in-flight retry encounters one, deduplicate by `actionId` and compare the available semantic
projection rather than appending a second request or rewriting immutable history.

**Why:** Deploys can resume attempts created by an older version. Rewriting their append-only events
is unsafe, while duplicating a request can corrupt later strategy extraction or effect attribution.

**How to apply:** Use the full action as the contract for new writes. Treat older projections only as
compatibility evidence, reject semantic conflicts, and keep strategy-learning projections separate
from authorization and execution authority.

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

For runtime stop, capture the target PID and port before signaling the process and carry both into
the after-state observer. The persisted terminal row clears its PID, so `pid = null` proves lease
release only; it does not prove that the old process exited. Before signaling, directly verify that
the exact owned session is running, the captured PID is alive, and its port is listening. Accept
stop only after the exact project/session/revision is terminal, ownership is released, the captured
PID is dead, and the captured port is closed.

**Why:** Clearing PID is part of the stop lifecycle and otherwise makes a terminal snapshot appear
to prove process death even when the original process identity was never checked. A stale snapshot
can also claim a stop effect if the process was already dead before the action began.

**How to apply:** Stop adapters must fail closed if pre-stop PID/port identity is missing, and must
probe those captured identities both before the action and after the durable stop transition before
emitting direct evidence.

For approved Mission repair file tools, `ACTION_COMMITTED` means only that a pending change was
staged in the candidate overlay. It is not a workspace effect and cannot support acceptance by
itself; the aggregate candidate's direct before/after observations and existing EffectBundle remain
the only mutation proof. Do not create per-tool EffectBundles or route read-only Mission profiles
through this mutation callback.

**Why:** These tool calls modify an in-memory candidate proposal, not the live workspace. Treating
tool completion as an observed effect would collapse the distinction between staged intent and
independent state change.

**How to apply:** Keep per-tool Action events idempotent and scope-bound, but leave effect
classification and acceptance attached to the aggregate candidate verification path.