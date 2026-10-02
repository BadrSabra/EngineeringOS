---
name: Shadow replay proof identity
description: Shadow replay rows distinguish source proof acceptance from replay proof acceptance.
---

Shadow Replay must persist source and replay Canonical Proof acceptance IDs separately. Any consumer that uses a replay receipt for completion or promotion must reload Canonical Proof from the replay execution's durable acceptance and evidence rows; a receipt's `PROVEN` label is never authoritative. The receipt ID, replay row's `replayCanonicalAcceptanceId`, and freshly loaded acceptance ID must agree.

**Why:** Reusing the source acceptance or trusting a stored `PROVEN` projection could let stale or forged receipt data authorize promotion without proof from the replay execution.

**How to apply:** Keep source and replay acceptance IDs in separate durable fields. Bind the reloaded proof to the replay execution, attempt, operation, project/Mission/Goal, active plan revision, source revision, and candidate identity; fail closed on any mismatch.