---
name: Tool failure terminality
description: The contract for handling agent tool failures across orchestration, persistence, and UI.
---

Required tool failures must be represented as typed failed or unavailable results with stable diagnostic codes. The model may receive only bounded safe context; raw exception details belong in server logs. A required failure must terminalize the operation so analysis, validation, repair, apply, commit, or push cannot be described as complete.

**Why:** Treating exceptions as ordinary tool text let the model continue and produce plausible but unsupported completion claims.

**How to apply:** Preserve the failure kind and diagnostic code through the agent trace, API/SSE boundary, persisted execution summary, and dashboard terminal state. Cancellation is also incomplete, not a successful result.