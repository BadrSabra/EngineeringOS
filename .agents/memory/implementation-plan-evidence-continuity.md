---
name: Implementation plan evidence continuity
description: Rules for carrying accepted source evidence from an earlier analysis turn into a later implementation plan.
---

Implementation planning should reuse previously accepted evidence only when the persisted evidence identifies the same workspace revision and its source path still exists in the current verified manifest. Mark those excerpts explicitly, prioritize their files in the planning context, and reject provider plans that ignore them.

**Why:** A plan that starts with a generic discovery step discards the proof already collected and can cause the model to propose unrelated or duplicated work. Revision and manifest checks prevent stale findings from steering a plan.

**How to apply:** Keep accepted excerpts separate from ordinary source snapshots, carry their file paths and bounded excerpts into both JSON and SSE planning requests, and use a contextual fallback when the provider fails or omits the accepted files. Never grant write authorization from this continuity alone.