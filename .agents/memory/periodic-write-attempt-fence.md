---
name: Periodic write attempt fences
description: Ownership rules for non-terminal AI execution writes during retries and worker reuse.
---

Checkpoint, orientation-manifest, and heartbeat writes must require the caller's expected attempt and match it atomically with the execution ID, worker ID, running status, and live lease.

**Why:** A stale callback can arrive after retry recovery reuses the same worker identity. Worker ID and lease checks alone then allow an old attempt to mutate the new attempt's durable state.

**How to apply:** Carry the claimed attempt through every periodic writer and preserve the retired attempt value in stale-worker tests. Keep the parameter required; optional compatibility would reopen the race.