---
name: Strategy replay acceptance boundary
description: Keep replay acceptance and replay Canonical Proof as separate, ordered checks.
---

Registered strategy replay should complete through the existing server-owned recipe acceptance path, then materialize and revalidate a distinct Canonical Proof for the replay. Stop the isolated runtime before confirming the accepted workspace tree is unchanged.

**Why:** Enabling the generic proof-required request flag on a recipe without a task objective routes completion through objective validation and can reject a successful observed effect. The replay still needs a Canonical Proof, but it can be built after normal recipe acceptance.

**How to apply:** Preserve the runtime recipe's normal acceptance contract. Bind the replay's separate proof to its own execution, attempt, episode, acceptance, effect bundle, and workspace hash; do not treat provider or source-case proof as replay proof.