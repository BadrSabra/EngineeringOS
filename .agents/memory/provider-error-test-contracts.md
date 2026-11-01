---
name: Provider error test contracts
description: Keep provider-failure test doubles faithful to structured production metadata.
---

Provider-failure fixtures must preserve the structured fields that route behavior depends on, especially provider identity, rate-limit scope, and positive retry duration. Otherwise an integration test may exercise a weaker error shape than production and falsely report metadata loss.

**Why:** A route-level 429 test used a test-only provider error class that omitted the scope field carried by the real error class. The persistence assertion failed because the fixture dropped the value before the route received it.

**How to apply:** When testing provider-failure persistence or cooldown policy, compare the fixture with the real typed error and assert metadata at its durable owner: acceptance disposition for scope/retry policy and execution checkpoint for provider attempts.

Test local adaptive cooldown behavior at the OpenRouter fallback/coordinator layer, not by calling the raw transport classifier. The raw transport records the provider's original 429; the wrapper chooses and records a local cooldown only after it knows the affected model or mapped pool.

**Why:** A test attempted to assert wrapper-generated cooldown metadata while invoking only the lower-level transport function, so its expectation could never be produced by that code path.

**How to apply:** For adaptive pool coverage, omit `Retry-After`, use an upstream provider namespace that exactly matches the model namespace, call the fallback wrapper, and assert both the bounded local delay and that only one provider attempt occurred.
