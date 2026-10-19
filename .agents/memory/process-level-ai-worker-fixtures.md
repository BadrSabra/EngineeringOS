---
name: Process-level AI worker fixtures
description: Test real task-worker lease and terminal behavior without coupling to provider credential setup.
---

For process-level AI task lifecycle tests, mock provider resolution only in the controlled worker child mode and keep the model call stubbed. Keep task claims, leases, acceptance writes, and completion events on the real disposable PostgreSQL database.

**Why:** A fresh disposable database plus a dummy provider environment key returned `428 AI provider not configured` before the worker claimed a lease, so the test did not reach its ownership boundary.

**How to apply:** When adding process-level task recovery or stale-worker tests, bypass only `requireProvider` for those child modes. Do not use this fixture pattern for tests whose subject is provider selection or credential validation.
