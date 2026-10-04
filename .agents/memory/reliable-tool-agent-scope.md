---
name: Reliable Tool Agent scope
description: Scope boundary for remaining first-layer Reliable Tool Agent work in EngineeringOS.
---

Complete the remaining Layer 1 Reliable Tool Agent work while keeping delegation and approval boundaries unchanged. Change other layers only when the tool-execution path depends directly on them. Console logs alone are not durable audit.

**Why:** The user explicitly set these constraints for the EngineeringOS Layer 1 closeout.

**How to apply:** Bind tool-dispatch records to the current execution, attempt, revision, scope, and manifest. Every well-formed, identity-bound attempt needs a durable terminal phase, including requests denied before start or cancelled during preflight. Emit `started` only after request persistence, cancellation, ownership, and budget checks pass and executor work is about to begin; preflight denials use `requested` → `failed`/`cancelled`, never `started`. Keep raw arguments out of durable records; telemetry never grants authority or replaces proof.