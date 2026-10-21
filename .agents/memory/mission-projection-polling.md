---
name: Mission Projection polling
description: Intentional active-Mission refresh cadence and original Chat return behavior.
---

Mission Projection refreshes every 3 seconds while a Mission is actively selected. This repeated read is intentional; preserve the cadence unless the active-Mission update contract is deliberately changed. Returning from Mission must continue to reopen the original Chat session.

Read-only Mission proof projections must not take D2 row locks. Keep those reads separate from the locked authorization and terminal-transition gates.

**Why:** Polling is required for fresh status and the original Chat handoff. A proof projection can overlap sibling Goal completion; taking `FOR UPDATE` locks during that read deadlocked against the D2 transition writer.

**How to apply:** Preserve the 3-second active projection cadence. When extending proof projection, use non-locking reads throughout D2 requirement and evidence revalidation; keep row locks in authorization and state-changing completion paths.
