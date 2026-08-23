---
name: Release pipeline hardening
description: Release validation safety boundaries, evidence retention, and retry policy.
---

Manual release validation must run only from the protected main ref inside its approved environment; provider-free checks stay deterministic, while live provider checks remain explicit opt-ins. Release child processes must have bounded lifetimes and process-group cleanup, and CI must retain both teardown and browser diagnostics.

**Why:** Release workflows handle production-like credentials and spawn multiple servers and test runners; an arbitrary ref, unbounded descendant, or overly broad retry can turn a validation check into a security or reliability risk.

**How to apply:** Preserve protected workflow gates and stable artifact paths when extending release checks. Retry only signal/known transient infrastructure failures, not assertion or configuration failures.