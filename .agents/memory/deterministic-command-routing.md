---
name: Deterministic command routing
description: Named local report/build commands must bypass natural-language AI intent routing.
---

A request that names a deterministic local function is not executable merely because the Arabic or English verb looks like an action. It needs an explicit server-owned command dispatcher; if no authorized handler exists, the route must fail closed before provider resolution rather than produce a narrative answer.

**Why:** The mission-correlation report request was classified as `BEHAVIOR_QUERY` at the classifier layer but promoted to `DELIVERY` by the independent execution-action check; no chat route recognized the named report builder, so provider failure occurred before the local report could run.

**How to apply:** Register deterministic commands before provider resolution, authenticate and validate their inputs server-side, keep generic action detection from granting delivery semantics to an unregistered function name, and return a typed unsupported-action result until a real handler is available.