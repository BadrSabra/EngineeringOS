---
name: Controlled release validation
description: How live provider-backed recovery validation is separated from ordinary release configuration tests.
---

Provider-backed process-recovery validation must remain an explicit opt-in command; ordinary configuration tests must continue to clear provider and database configuration so they never make live calls.

**Why:** The recovery test starts a real API child process and can spend significant time against an external provider, while configuration regressions need deterministic failure-path coverage.

**How to apply:** Use the controlled release command only in an environment with the required provider and database configuration. For OpenRouter live recovery, set `OPENROUTER_MODEL` to a paid tool-capable model when the free catalog is unavailable. Keep the normal scripts test suite provider-free and assert that the deployment chain still propagates recovery failures.