---
name: Nested release lock ownership
description: Focused release checks invoked inside the quality gate must reuse the campaign lock rather than acquire it again.
---

Release quality-gate children that invoke a release runner must explicitly reuse the parent campaign's database-isolation lock, and deployment post-build validation must enter through the serialized validation runner.

**Why:** The quality gate holds the shared lock for the whole campaign; a nested runner that acquires it independently will report a false database-isolation collision even though the campaign is correctly serialized.

**How to apply:** Keep lock reuse opt-in for the focused child path, run deployment post-build checks through `scripts/run-release-validation.mjs` with bounded lock-wait behavior, and let standalone release-runner invocations acquire and clean up their own lock.