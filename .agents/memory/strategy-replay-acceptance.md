---
name: Strategy replay acceptance boundary
description: Keep replay acceptance and replay Canonical Proof as separate, ordered checks.
---

Registered Strategy Replay admission requires Canonical Proof bound to the current source or replay execution and attempt. Runtime lifecycle recipes (`runtime.start`, `runtime.restart`, and `runtime.stop`) remain operational-only for Canonical Proof. `runtime.start` can complete Gate C operationally—direct observations, an `OBSERVED` effect bundle, a materialized transition, and `SUCCEEDED` acceptance—while acceptance still has `evidenceRequired=0`, `evidenceComplete=1`, and no evidence snapshot. The episode remains `verifying`; this is not Canonical Proof and must not admit the episode as a replay source.

**Why:** The generic proof-required completion path expects an `AutonomousOperationContract`, which a recipe-bound checkpoint does not carry. Forcing `proofRequired` on `runtime.start` blocks the operation rather than producing valid proof. Operational success, receipts, observations, effects, and transitions cannot substitute for the missing acceptance contract.

**How to apply:** Preserve Gate C's existing operational acceptance. Before using any runtime lifecycle recipe as a replay source or replay, design a distinct server-owned recipe proof contract that validates durable Gate C evidence and binds it to the current execution, attempt, episode, acceptance, effect bundle, and workspace identity. Until then, keep proof materialization fail-closed. Stored `incomplete` and `proven` receipt recovery remain unverified end-to-end because the integration assertions sit behind the proof-producing source path; pure identity tests do not replace that coverage. Stop the isolated runtime before confirming the accepted workspace tree is unchanged.

Candidate admission is also a Canonical Proof boundary: a matching proposal/operation acceptance selected by a broad query must still match the execution's current attempt through `loadCanonicalProof`.

**Why:** The candidate route can find a valid-looking acceptance and snapshot from an earlier attempt even when the execution has advanced; that older projection must not materialize a proof-carrying candidate.

**How to apply:** Keep the canonical loader and acceptance-ID comparison before candidate creation. Test wrong-attempt acceptance/snapshot rows and assert the route rejects admission without mutating proposal evidence.

A terminal `incomplete` Strategy Replay receipt is immutable. A new attempt requires a caller-supplied UUID and is admitted only after revalidating the stored incomplete receipt, current source Canonical Proof, clean source revision, project opt-in, and candidate identity/status. Proven attempts and live attempts cannot be retried; repeating the same UUID resolves to the same attempt.

**Why:** Reusing or overwriting a terminal receipt would erase failure history, while retrying against stale proof, changed source, revoked consent, or a stale candidate could misattribute a result.

**How to apply:** Append a distinct case-attempt row, bind the request UUID to its operation identity, and bind the new run ID and attempt number into schema-v2 receipts and replay scope. Keep legacy schema-v1 first-attempt receipts readable. Isolated storage tests can prove lease fencing and append-only retry persistence, but they do not replace positive runner coverage while the recipe proof producer remains unavailable.