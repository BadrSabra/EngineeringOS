---
name: Process-level AI worker fixtures
description: Test real task-worker lease and terminal behavior without coupling to provider credential setup.
---

For process-level AI task lifecycle tests, mock provider resolution only in the controlled worker child mode and keep the model call stubbed. Keep task claims, leases, acceptance writes, and completion events on the real disposable PostgreSQL database.

**Why:** A fresh disposable database plus a dummy provider environment key returned `428 AI provider not configured` before the worker claimed a lease, so the test did not reach its ownership boundary.

**How to apply:** When adding process-level task recovery or stale-worker tests, bypass only `requireProvider` for those child modes. Do not use this fixture pattern for tests whose subject is provider selection or credential validation.

## Child-process shutdown for lease races

When a worker child waits on stdin as a transaction-race barrier, destroy or close that stdin stream after receiving the signal, then assert the child exits. Receiving one data event or pausing the stream can leave Node alive even after the worker has emitted its expected rejection.

**Why:** A stale scan worker correctly rejected its terminal write and rolled back, but the test timed out because the child retained the stdin pipe.

**How to apply:** In process-level lease tests, distinguish the worker's result from harness shutdown: collect the rejection marker, close the coordination stream, and wait for a clean child exit before checking durable state.
