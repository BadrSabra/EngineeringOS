---
name: Artifact-only acceptance
description: Delivery executions can satisfy the proof contract with server-owned validation evidence without source-file reads.
---

The acceptance contract and the source-read requirement are separate signals. A delivery/build handoff with a server-owned validation receipt may persist a complete artifact-only evidence snapshot with zero reads, while forensic and source-analysis executions must still require complete retained reads.

**Why:** Requiring source reads for every proof-required execution rejected valid Plan → Build handoffs even when node state and validation evidence were server-owned, operation-bound, and revision-bound.

**How to apply:** Preserve `required` for the durable proof contract, and set source-evidence requirements independently when finalizing acceptance. Never weaken the autonomous operation identity, node, revision, or validation-evidence checks.