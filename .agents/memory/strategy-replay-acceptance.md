---
name: Strategy replay acceptance boundary
description: Keep replay acceptance and replay Canonical Proof as separate, ordered checks.
---

Registered strategy replay should complete through the existing server-owned recipe acceptance path, then materialize and revalidate a distinct Canonical Proof for the replay. Stop the isolated runtime before confirming the accepted workspace tree is unchanged.

**Why:** Enabling the generic proof-required request flag on a recipe without a task objective routes completion through objective validation and can reject a successful observed effect. The replay still needs a Canonical Proof, but it can be built after normal recipe acceptance.

**How to apply:** Preserve the runtime recipe's normal acceptance contract. Bind the replay's separate proof to its own execution, attempt, episode, acceptance, effect bundle, and workspace hash; do not treat provider or source-case proof as replay proof.

Candidate admission is also a Canonical Proof boundary: a matching proposal/operation acceptance selected by a broad query must still match the execution's current attempt through `loadCanonicalProof`.

**Why:** The candidate route can find a valid-looking acceptance and snapshot from an earlier attempt even when the execution has advanced; that older projection must not materialize a proof-carrying candidate.

**How to apply:** Keep the canonical loader and acceptance-ID comparison before candidate creation. Test wrong-attempt acceptance/snapshot rows and assert the route rejects admission without mutating proposal evidence.