---
name: Strategy replay acceptance boundary
description: Keep replay acceptance and replay Canonical Proof as separate, ordered checks.
---

Registered Strategy Replay admission requires Canonical Proof bound to the current source or replay execution and attempt. Operational Gate C success alone is not proof. The current `runtime.start` path can produce Canonical Proof through its dedicated Gate C evidence path when the fresh direct observations, effect bundle, acceptance, evidence snapshot, scope, revision, and attempt satisfy the canonical loader. Do not generalize that producer to `runtime.restart` or `runtime.stop`.

**Why:** The generic proof-required completion path expects an `AutonomousOperationContract`, which a recipe-bound checkpoint does not carry. The dedicated Gate C path is separate: runtime status, a successful receipt, an effect bundle, or a world transition cannot independently substitute for reloaded Canonical Proof.

**How to apply:** Reload Canonical Proof from durable acceptance and evidence for the exact execution, attempt, episode, scope, revision, and workspace identity before producing a source binding or accepting a replay. Keep proof materialization fail-closed for recipes without their own proof producer. Positive replay, incomplete-receipt recovery, a new proven attempt, and proof-binding reload have been exercised against a fresh disposable database; a stored `proven` receipt still cannot replace that reload.

Candidate admission is also a Canonical Proof boundary: a matching proposal/operation acceptance selected by a broad query must still match the execution's current attempt through `loadCanonicalProof`.

**Why:** The candidate route can find a valid-looking acceptance and snapshot from an earlier attempt even when the execution has advanced; that older projection must not materialize a proof-carrying candidate.

**How to apply:** Keep the canonical loader and acceptance-ID comparison before candidate creation. Test wrong-attempt acceptance/snapshot rows and assert the route rejects admission without mutating proposal evidence.

A terminal `incomplete` Strategy Replay receipt is immutable. A new attempt requires a caller-supplied UUID and is admitted only after revalidating the stored incomplete receipt, current source Canonical Proof, clean source revision, project opt-in, and candidate identity/status. Proven attempts and live attempts cannot be retried; repeating the same UUID resolves to the same attempt.

**Why:** Reusing or overwriting a terminal receipt would erase failure history, while retrying against stale proof, changed source, revoked consent, or a stale candidate could misattribute a result.

**How to apply:** Append a distinct case-attempt row, bind the request UUID to its operation identity, and bind the new run ID and attempt number into schema-v2 receipts and replay scope. Keep legacy schema-v1 first-attempt receipts readable. Positive runner coverage verifies one successful fresh retry and persisted receipt recovery; preserve the same lease, source-proof, and current-attempt checks in any new replay path.
