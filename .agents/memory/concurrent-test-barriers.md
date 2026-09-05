---
name: Concurrent test barriers
description: Reliable synchronization patterns for same-session concurrent request fixtures
---

Concurrent request fixtures should select mocked behavior from a request-owned identity and synchronize on an explicit readiness barrier with a bounded timeout.

**Why:** Queued mock implementations make callback ownership depend on scheduler order, while unbounded polling can hang a release validation process when one request never reaches the provider boundary.

**How to apply:** For same-session out-of-order tests, identify each turn from its input, reset any queued one-shot implementations before installing identity dispatch, signal at the provider boundary rather than after an arbitrary delay, clear the timeout after the barrier resolves, and then release completions in the intended order.

Project fixtures must also use a unique, existing temporary root per inserted project; never rely on a shared fixed root such as `/tmp` when release suites can overlap.

**Why:** The project root has a uniqueness constraint, so an interrupted or concurrent fixture can block a later insert and turn a deterministic test into a timeout.

**How to apply:** Derive the root from the fixture project identity, create it before insertion, use it for absolute change paths, and remove it recursively in the fixture cleanup.