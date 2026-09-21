---
name: Objective replan evidence
description: Bounded objective recovery must feed retained evidence windows into the same server-owned materialization and acceptance lane as the initial tool loop.
---

Objective replan reads are not complete proof merely because their file bodies are retained. Their evidence windows must be merged into the objective materialization input before response-bound claim closure and evidence-graph projection.

**Why:** A recovery can successfully read the missing source while the final objective gate still sees zero accepted evidence if the recovery window remains telemetry-only.

**How to apply:** When adding or changing bounded objective recovery, verify the recovered windows flow through project-query materialization, claim closure, evidence graph reads, and the terminal response—not only `fileContents` or read counters.