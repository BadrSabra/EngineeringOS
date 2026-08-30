---
name: Release test isolation
description: Rules for running API integration tests safely when historical artifact copies share a database
---

Release API integration checks must run from the owning artifact root, name the canonical test file explicitly, and serialize access to shared mutable database fixtures.

**Why:** Historical artifact copies can otherwise resolve the same suite in parallel and make cleanup races look like flaky application behavior.

**How to apply:** Keep the release wrapper package-scoped and fail clearly on a duplicate root or an existing isolation lock; do not delete historical copies as a workaround.

Browser release checks should be judged from the release runner's own service ports and owning workspace, not from whichever historical artifact copy happens to be listening on a similar port.

**Why:** Concurrent validation artifacts can leave healthy but stale dashboard servers running; probing one of those servers can produce failures that do not match the current source.

**How to apply:** Use the controlled release wrapper for the final browser result and treat direct checks against copied artifact ports as diagnostic only.

Provider-free release recovery and the dashboard journey must share a broader
validation lock, while the AI stream lock remains narrower and independent.

**Why:** The completion validator starts these checks concurrently; without one
shared boundary, database-backed discovery cleanup and other mutable fixtures
can race even when each command passes alone.

**How to apply:** Have both managed validation entrypoints acquire the same
bounded lock when database-backed checks are enabled, and release it in a
finally path before reporting teardown complete.