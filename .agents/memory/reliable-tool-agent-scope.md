---
name: Reliable Tool Agent scope
description: Scope boundary for remaining first-layer Reliable Tool Agent work in EngineeringOS.
---

Complete the remaining Layer 1 Reliable Tool Agent work while keeping delegation and approval boundaries unchanged. Change other layers only when the tool-execution path depends directly on them. Console logs alone are not durable audit.

**Why:** The user explicitly set these constraints for the EngineeringOS Layer 1 closeout. Loop-level policy gates and cache replays can bypass lower-level dispatch audit even though they still answer a tool call.

**How to apply:** Bind tool-dispatch records to the current execution, attempt, revision, scope, and manifest. Audit server-side paths that skip normal dispatch: valid preflight denials use `requested` → `failed`/`cancelled`; a cached result records `requested` → `started` → `completed` with an output hash only after cancellation/ownership checks, without consuming fresh-tool budget. Emit `started` only after request persistence, cancellation, ownership, and budget checks pass and executor work is about to begin. Keep raw arguments out of durable records; telemetry never grants authority or replaces proof.