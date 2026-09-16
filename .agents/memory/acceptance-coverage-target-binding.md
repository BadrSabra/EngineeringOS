---
name: Acceptance coverage target binding
description: Meta-requests that enumerate task families must not be routed to a subsystem target by incidental provider or analysis keywords.
---

Multi-task acceptance coverage requests are meta-level contract requests, not embedded-AI project queries. Target resolution must recognize the requested coverage shape before applying subsystem keyword heuristics; retries must preserve the corrected contract, not an incidental target.

**Why:** A request listing “project analysis”, “file conversion”, “media”, and provider/acceptance terms was routed to the embedded-AI target because generic keyword signals were treated as a subsystem request. The evidence scheduler then completed the wrong objective repeatedly, while a `NOT_PROVEN` finding remained inconsistent with accepted `PROVEN` execution state.

**How to apply:** Add a server-owned meta acceptance objective/target (or an explicit target-resolution precedence rule) for cross-task coverage requests. Bind task-objective kind to the resolved turn intent, and require terminal acceptance to reject semantic task results such as `FINDING_RESULT/NOT_PROVEN` with empty evidence even when generic evidence claims are complete.