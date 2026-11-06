---
name: Runtime start database serialization
description: Why concurrent API workers need a transaction-scoped project lock before creating a runtime row.
---

Acquire a project-scoped PostgreSQL transaction lock before the runtime-row upsert. The runtime row stores the project identity both as its primary key and as a separately unique project ID; competing inserts can surface the primary-key collision before the targeted conflict handler.

**Why:** A repeated process-level race test reproduced a primary-key violation when two API workers reached the insert simultaneously, even though the upsert targeted the unique project ID.

**How to apply:** Keep the advisory lock and conditional upsert in one transaction. Validate with separate API processes synchronized immediately before the durable claim, and compare the winning worker/session to both the supervisor's live session and the persisted lease.
