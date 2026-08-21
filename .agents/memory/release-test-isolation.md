---
name: Release test isolation
description: Rules for running API integration tests safely when historical artifact copies share a database
---

Release API integration checks must run from the owning artifact root, name the canonical test file explicitly, and serialize access to shared mutable database fixtures.

**Why:** Historical artifact copies can otherwise resolve the same suite in parallel and make cleanup races look like flaky application behavior.

**How to apply:** Keep the release wrapper package-scoped and fail clearly on a duplicate root or an existing isolation lock; do not delete historical copies as a workaround.