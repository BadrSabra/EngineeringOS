---
name: Dashboard effect fixtures
description: Authenticated dashboard tests must model fresh network responses when React effects can be replayed.
---

When an authenticated dashboard effect may be replayed by React Strict Mode, one-shot network fixtures must create a fresh response for every request; a shared consumed response can make the valid second attempt look like a recovery failure.

**Why:** Strict Mode cleanup can cancel the first effect instance while the second instance legitimately retries the request. Reusing a response object makes the retry observe an already-consumed body.

**How to apply:** Use a mock implementation that constructs a new response per invocation, and ensure cleanup releases any in-flight marker so a canceled effect cannot block its replacement.