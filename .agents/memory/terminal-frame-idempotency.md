---
name: Terminal frame idempotency
description: Durable acceptance UIs must ignore duplicate or stale terminal stream frames.
---

The first terminal SSE frame for a client stream is authoritative; later `done` or `error` frames from that request must be ignored.

**Why:** A reconnect or provider boundary can expose duplicated terminal frames. Without a one-shot client guard, a stale failure can overwrite an already accepted result even though the server-owned ledger is correct.

**How to apply:** Keep terminal delivery state scoped to each stream attempt, set it before invoking the consumer callback, and ignore all later terminal callbacks for that attempt.