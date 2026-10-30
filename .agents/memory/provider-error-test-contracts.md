---
name: Provider error test contracts
description: Keep provider-failure test doubles faithful to structured production metadata.
---

Provider-failure fixtures must preserve the structured fields that route behavior depends on, especially provider identity, rate-limit scope, and positive retry duration. Otherwise an integration test may exercise a weaker error shape than production and falsely report metadata loss.

**Why:** A route-level 429 test used a test-only provider error class that omitted the scope field carried by the real error class. The persistence assertion failed because the fixture dropped the value before the route received it.

**How to apply:** When testing provider-failure persistence or cooldown policy, compare the fixture with the real typed error and assert metadata at its durable owner: acceptance disposition for scope/retry policy and execution checkpoint for provider attempts.
