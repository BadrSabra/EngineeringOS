---
name: Periodic write attempt fences
description: Ownership rules for non-terminal AI execution writes during retries and worker reuse.
---

Checkpoint, orientation-manifest, and heartbeat writes must require the caller's expected attempt and match it atomically with the execution ID, worker ID, running status, and a live lease evaluated using the database clock.

**Why:** A stale callback can arrive after retry recovery reuses the same worker identity. Worker ID and lease checks alone then allow an old attempt to mutate the new attempt's durable state; host clock skew can also make separate API instances disagree about whether the same lease is live.

**How to apply:** Carry the claimed attempt through every periodic writer and preserve the retired attempt value in stale-worker tests. Create, renew, and expire durable leases against PostgreSQL time, not a worker's wall clock. Keep the attempt parameter required; optional compatibility would reopen the race.