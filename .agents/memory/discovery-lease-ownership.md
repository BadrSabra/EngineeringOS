---
name: Discovery lease ownership
description: Durable ownership rule for discovery progress and terminal state.
---

Discovery workers must include their current worker identity when writing progress or terminal state. A lease-expiry reconciler can mark the session incomplete while the old worker is still unwinding; an unconditional later write would otherwise overwrite the newer durable outcome.

**Why:** Discovery has no resumable checkpoint between pipeline stages, so lease expiry creates an explicit terminal boundary rather than a safe replay point.

**How to apply:** Keep progress, ready, and error writes behind the session's current worker lease and status. Lease release must happen only after the owner-scoped terminal write.