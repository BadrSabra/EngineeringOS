---
name: Controlled release validation
description: How live provider-backed recovery validation is separated from ordinary release configuration tests.
---

Provider-backed process-recovery validation must remain an explicit opt-in command; ordinary configuration tests must continue to clear provider and database configuration so they never make live calls.

**Why:** The recovery test starts a real API child process and can spend significant time against an external provider, while configuration regressions need deterministic failure-path coverage.

**How to apply:** Use the controlled release command only in an environment with the required provider and database configuration. For OpenRouter live recovery, set `OPENROUTER_MODEL` to a paid tool-capable model when the free catalog is unavailable. Keep the normal scripts test suite provider-free and assert that the deployment chain still propagates recovery failures.

The dashboard release journey may use a provider-free Groq catalog fixture guarded by
`RUN_CONTROLLED_RELEASE_VALIDATION=1`; its local control surface should change only
bounded catalog states and the browser evidence should read the real authenticated
alert endpoint.

**Why:** Catalog outage and retired-model drift are operator-visible persistence
contracts that need real process restarts, but release checks must not depend on
provider credentials or expose provider diagnostics.

**How to apply:** Keep timeout, healthy, and retired states explicit; deduplicate
repeated outage observations, resolve them on healthy startup, and retain a
redacted evidence receipt linked from release teardown.