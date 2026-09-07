---
name: Analysis correlation and cancellation
description: Project scanner, graph, and discovery evidence must remain tied to one operation and workspace revision.
---

Analysis results are only usable when their operation ID, workspace revision, and evidence provenance match the active turn. A timed-out or cancelled analysis must abort its underlying work and cannot publish a late result.

**Why:** Provider retries and reconnects can outlive the request that started them, while scans can mutate project state during execution.

**How to apply:** Thread one correlation envelope through every analysis runner call, persist its workspace revision with durable executions for reconnects, reject mismatches before model/evidence ingestion, and check cancellation before any scan transaction writes.

The durable execution row and provider telemetry must use the same correlation identity; assigning an initial analysis UUID to the execution row and later switching telemetry to the generated operation ID creates a cross-surface join gap even when each individual row is valid.

**Why:** A live execution persisted one correlation ID on `ai_executions`, while its `ai_usage_events` rows used the execution operation ID as their correlation ID.

**How to apply:** Choose the operation/correlation identity before execution creation, persist it once, and pass that same value to execution state, telemetry, events, checkpoints, and exported reports.

The workspace revision must also be resolved from the context manifest before
creating the durable execution; otherwise the request can persist a project
timestamp while the session and evidence pipeline use a source/tree revision.

**Why:** The stream route previously created the execution before loading the
project context, allowing two valid-looking but incompatible revision formats
to reach the acceptance gate.

**How to apply:** Build the canonical project context first, update the
correlation envelope once, then use that revision for the execution request,
resume contract, session state, operation manifest, and evidence binding.