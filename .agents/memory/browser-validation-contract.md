---
name: Browser validation contract
description: Browser checks are server-owned profiles over an isolated pending-change workspace.
---

Browser validation must receive a server-selected profile whose revision, localhost origin, fixed steps, and resource limits are validated before opening a page; pending changes are materialized into an isolated workspace.

**Why:** Model-supplied URLs, selectors, commands, or live roots could turn a verification step into unrestricted navigation or validate code different from the proposed patch.

**How to apply:** Keep browser metadata path-free in public evidence, distinguish failed checks from unavailable previews, and reuse the same approved profile and revision for bounded repair retries.

Caller abort and timeout cannot be passed directly to Playwright page operations. Keep the in-flight step promise, close page and browser resources promptly, then wait a bounded time for that step to settle before returning.

**Why:** Racing a timeout against navigation can return while the Playwright operation is still pending; cleanup must not leave detached browser work or hang task finalization indefinitely.

**How to apply:** Use bounded best-effort settlement after resource closure, and keep a real Chromium stalled-response cancellation test alongside fake-runner tests; mocks alone cannot establish driver behavior.