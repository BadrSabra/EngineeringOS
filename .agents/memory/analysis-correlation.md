---
name: Analysis correlation and cancellation
description: Project scanner, graph, and discovery evidence must remain tied to one operation and workspace revision.
---

Analysis results are only usable when their operation ID, workspace revision, and evidence provenance match the active turn. A timed-out or cancelled analysis must abort its underlying work and cannot publish a late result.

**Why:** Provider retries and reconnects can outlive the request that started them, while scans can mutate project state during execution.

**How to apply:** Thread one correlation envelope through every analysis runner call, persist its workspace revision with durable executions for reconnects, reject mismatches before model/evidence ingestion, and check cancellation before any scan transaction writes.