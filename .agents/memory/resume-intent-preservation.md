---
name: Resume intent preservation
description: Durable turn intent must survive prompt augmentation during recovery and reconnect flows.
---

Server-owned turn intent is authoritative after a request is resumed. Do not derive execution modes such as project orientation from an exact-match detector over the augmented model prompt, because recovery context is appended before the orchestrator runs.

**Why:** A resumed orientation request can retain complete source reads and its role manifest while the augmented prompt no longer matches the original orientation phrase. The orchestrator then falls back to a generic plan, omits orientation coverage, and terminal acceptance correctly rejects the otherwise complete read set.

**How to apply:** Pass or derive an explicit orientation flag from the durable request/TurnIntent, and keep raw-message detectors for fresh-request classification only. Add a recovery test that appends resume context and asserts the role manifest drives the source-selection record.