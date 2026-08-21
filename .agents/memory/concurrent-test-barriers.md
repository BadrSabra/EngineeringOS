---
name: Concurrent test barriers
description: Reliable synchronization patterns for same-session concurrent request fixtures
---

Concurrent request fixtures should select mocked behavior from a request-owned identity and synchronize on an explicit readiness barrier with a bounded timeout.

**Why:** Queued mock implementations make callback ownership depend on scheduler order, while unbounded polling can hang a release validation process when one request never reaches the provider boundary.

**How to apply:** For same-session out-of-order tests, identify each turn from its input, reset any queued one-shot implementations before installing identity dispatch, signal once all expected calls have entered, clear the timeout after the barrier resolves, and then release completions in the intended order.