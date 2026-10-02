---
name: Shadow replay proof identity
description: Shadow replay rows distinguish source proof acceptance from replay proof acceptance.
---

Shadow Replay must persist source and replay Canonical Proof acceptance IDs separately. Any consumer that uses a replay receipt for completion or promotion must reload Canonical Proof from the current execution attempt's durable acceptance and evidence rows; a receipt's `PROVEN` label is never authoritative. The receipt ID, replay row's `replayCanonicalAcceptanceId`, and freshly loaded acceptance ID must agree, and the loaded trajectory must match the receipt.

**Why:** Reusing the source acceptance or trusting a stored `PROVEN` projection could let stale receipt data complete an expired replay or promote a skill after its proof no longer matches the current attempt.

**How to apply:** Keep source and replay acceptance IDs in separate durable fields. Bind the reloaded proof to the replay execution, current attempt, operation, project/Mission/Goal, active plan revision, source revision, and candidate identity. Recovery and promotion must check the receipt ID and trajectory before marking completed or promoted.