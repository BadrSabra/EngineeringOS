---
name: Strategy replay acceptance boundary
description: Keep replay acceptance and replay Canonical Proof as separate, ordered checks.
---

Registered Strategy Replay admission requires Canonical Proof bound to the current source or replay execution and attempt. `runtime.start` can complete Gate C operationally—direct observations, an `OBSERVED` effect bundle, a materialized transition, and `SUCCEEDED` acceptance—while acceptance still has `evidenceRequired=0`, `evidenceComplete=1`, and no evidence snapshot. The episode remains `verifying`; this is not Canonical Proof and must not admit the episode as a replay source.

**Why:** The generic proof-required completion path expects an `AutonomousOperationContract`, which a recipe-bound checkpoint does not carry. Forcing `proofRequired` on `runtime.start` blocks the operation rather than producing valid proof. Operational success, receipts, observations, effects, and transitions cannot substitute for the missing acceptance contract.

**How to apply:** Preserve Gate C's existing operational acceptance. Before using `runtime.start` as a replay source or replay, design a distinct server-owned recipe proof contract that validates durable Gate C evidence and binds it to the current execution, attempt, episode, acceptance, effect bundle, and workspace identity. Until then, keep proof materialization fail-closed. Recovery of a stored `proven` receipt remains unverified without a genuine proof-producing fixture. Stop the isolated runtime before confirming the accepted workspace tree is unchanged.

Candidate admission is also a Canonical Proof boundary: a matching proposal/operation acceptance selected by a broad query must still match the execution's current attempt through `loadCanonicalProof`.

**Why:** The candidate route can find a valid-looking acceptance and snapshot from an earlier attempt even when the execution has advanced; that older projection must not materialize a proof-carrying candidate.

**How to apply:** Keep the canonical loader and acceptance-ID comparison before candidate creation. Test wrong-attempt acceptance/snapshot rows and assert the route rejects admission without mutating proposal evidence.