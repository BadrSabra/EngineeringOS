---
name: Audit outbox durability
description: Durable audit retry queues must be loaded before traffic and remain idempotent during recovery.
---

The audit retry path uses a durable outbox separate from the final audit history. Startup loading must happen before the server accepts requests, and final audit insertion must tolerate an already-written row so a cleanup failure cannot create duplicates.

**Why:** A process can stop after writing the final audit row but before deleting its outbox entry; recovery must preserve the row without duplicating it.

**How to apply:** For future durable retry queues, persist retry metadata, reload it during startup, expose pending state through health telemetry, and make destination writes idempotent.