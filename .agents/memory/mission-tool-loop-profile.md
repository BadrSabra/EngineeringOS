---
name: Mission tool-loop profile boundary
description: Server-owned Mission plan steps select the execution profile and tool permissions; legacy tasks retain TaskAgent behavior.
---

Mission execution profiles are derived from the persisted plan step, not from provider output. Inspect/analyze steps use a read-only Tool Loop, execute uses the bounded repair profile, validate uses validation-only tools, and recipe-backed delivery stays on the recipe path. Tasks without a persisted Mission step must remain on the legacy analysis executor.

**Why:** Existing durable tasks and fixtures may not have a Mission plan profile; treating missing metadata as a tool-loop request changes lifecycle behavior and can block or fail unrelated tasks.

**How to apply:** When adding a new Mission executor, persist its profile in the server-owned Goal contract and preserve an explicit analysis fallback for legacy tasks. Keep write scope, approval state, and validation callbacks server-owned.

For approved Mission repair, carry the server-supplied `repair_plan` mode and approved target paths into the Tool Loop independently of natural-language `immediateIntent` or `repairPlanExecution` inference. Complete prefetched evidence must suppress redundant reads, not disable authorized mutation and validation tools.

**Why:** Mission's server-owned DELIVERY intent can be valid even when the wrapped task text does not match chat's interactive repair-plan phrasing. Dropping the execution mode at the Tool Loop boundary lets objective-evidence completion switch an approved repair into no-tools synthesis before a candidate is staged.

**How to apply:** Forward the mode only when approval and concrete target paths are present; keep the existing independent approval, manifest, and path fences. Cover both Tool Loop gating and the Mission-to-chat handoff in regression tests.