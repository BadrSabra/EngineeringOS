---
name: Mission tool-loop profile boundary
description: Server-owned Mission plan steps select the execution profile and tool permissions; legacy tasks retain TaskAgent behavior.
---

Mission execution profiles are derived from the persisted plan step, not from provider output. Inspect/analyze steps use a read-only Tool Loop, execute uses the bounded repair profile, validate uses validation-only tools, and recipe-backed delivery stays on the recipe path. Tasks without a persisted Mission step must remain on the legacy analysis executor.

**Why:** Existing durable tasks and fixtures may not have a Mission plan profile; treating missing metadata as a tool-loop request changes lifecycle behavior and can block or fail unrelated tasks.

**How to apply:** When adding a new Mission executor, persist its profile in the server-owned Goal contract and preserve an explicit analysis fallback for legacy tasks. Keep write scope, approval state, and validation callbacks server-owned.