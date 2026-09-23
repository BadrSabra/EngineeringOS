---
name: Shadow replay proof identity
description: Shadow replay rows distinguish source proof acceptance from replay proof acceptance.
---

Shadow Replay must persist the source Canonical Proof acceptance separately from the new Canonical Proof acceptance produced by the replay execution. The receipt and durable replay row must agree on the replay acceptance identity before recovery can report completion.

**Why:** Reusing the source acceptance would make a successful validation recipe look like proof from the replay execution, weakening the Mission → Goal → Execution → Evidence → Acceptance → Proof chain.

**How to apply:** Keep source and replay acceptance IDs in separate durable fields, bind the replay receipt to the replay field, and fail closed when recovery finds a mismatch.