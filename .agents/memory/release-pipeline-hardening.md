---
name: Release pipeline hardening
description: Release validation safety boundaries, evidence retention, and retry policy.
---

Manual release validation must run only from the protected main ref inside its approved environment; provider-free checks stay deterministic, while live provider checks remain explicit opt-ins. Release child processes must have bounded lifetimes and process-group cleanup, and CI must retain both teardown and browser diagnostics.

Nested checks launched by a campaign that owns the shared API-stream lock must inherit that ownership rather than reacquire the same lock. A wait policy is not ownership: inspect and validate the recorded owner first, wait only for a verified live owner, and reclaim only a verified stale lock. Keep the API-stream and release-validation locks independent, with a distinct explicit ownership handoff for each; never use the API-stream marker to bypass the separate validation lock.

**Why:** Release workflows handle production-like credentials and spawn multiple servers and test runners; an arbitrary ref, unbounded descendant, or overly broad retry can turn a validation check into a security or reliability risk. Reacquiring a parent-held lock from a nested preview deadlocks the campaign, while treating ownership of one lock as ownership of another can make nested validation wait forever.

**How to apply:** Preserve protected workflow gates and stable artifact paths when extending release checks. Propagate each lock's ownership only after its parent acquires that lock; standalone entrypoints acquire their own locks. Retry only signal/known transient infrastructure failures—not assertion or configuration failures.