---
name: Resume intent preservation
description: Durable turn intent must survive prompt augmentation during recovery and reconnect flows.
---

Server-owned turn intent is authoritative after a request is resumed. Do not derive execution modes such as project orientation from an exact-match detector over the augmented model prompt, because recovery context is appended before the orchestrator runs.

**Why:** A resumed orientation request can retain complete source reads and its role manifest while the augmented prompt no longer matches the original orientation phrase. The orchestrator then falls back to a generic plan, omits orientation coverage, and terminal acceptance correctly rejects the otherwise complete read set.

**How to apply:** Pass or derive an explicit orientation flag from the durable request/TurnIntent, and keep raw-message detectors for fresh-request classification only. Add a recovery test that appends resume context and asserts the role manifest drives the source-selection record.

Recovery must also pass the execution-bound task state into the agent after the execution is claimed; a pre-claim session snapshot can carry an older operation identity even when the durable request and correlation have already advanced.

**Why:** A forensic resume was rejected before its first source read because the agent compared the newly claimed operation correlation with the stale session state supplied from before execution creation.

**How to apply:** Build one current state envelope from the claimed execution/request and use it for the chat agent, failure persistence, and evidence scheduling. Treat the persisted request's turn intent as authoritative during automatic recovery.