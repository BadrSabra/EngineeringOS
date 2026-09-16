---
name: Durable orientation role manifest
description: Orientation resume and provider fallback must preserve the server-owned role-to-path mapping.
---

The orientation role manifest is server-owned and bound to the managed project root and workspace revision. Persist the four role path sets in the existing resume contract, retain a checkpoint copy for legacy recovery, and pass the same mapping through every provider fallback attempt. A resumed orientation must skip replanning and read only the persisted role paths; evidence reuse may satisfy already-complete reads, but the final role coverage gate remains authoritative.

**Why:** Replanning on resume or fallback can change role coverage and make the same execution depend on a different source set.

**How to apply:** Extend the existing resume contract and checkpoint parser with bounded validation; update the shared fallback params when the first manifest is captured so later attempts see it too.