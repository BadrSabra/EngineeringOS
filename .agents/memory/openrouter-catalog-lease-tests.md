---
name: OpenRouter catalog lease integration tests
description: Keep database lease tests representative of concurrent callers and stable under scheduling.
---

Exercise lease arbitration through independent PostgreSQL sessions, not only mocked adapters or a single connection.

Acquire helpers with a zero-millisecond wait can skip the first database attempt if scheduling time elapses before the loop condition; use a short positive bound when the test expects an initial acquisition.

**Why:** an isolated PostgreSQL test exposed a false failure before SQL ran when the initial lease request used a zero wait; the database-level fencing itself passed with a bounded wait.

**How to apply:** for lease ownership, expiry, or shared-backoff tests, use disposable loopback PostgreSQL and separate checked-out sessions; assert the persisted state and exact stale-writer rejection.
