---
name: Route fallback fixtures
description: Durable fixture constraints for testing real chatWithFallback exhaustion through the SSE route.
---

Route-level provider-exhaustion fixtures must mock provider lifecycle selectability for every credential-bearing provider, not only the intended test provider. The test environment may expose additional provider secrets, which otherwise consume the one-shot failure fixture and turn the test into a provider-success path.

**Why:** A real helper call enumerates configured providers and refreshes the candidate list after a transient failure. An unisolated OpenRouter credential caused the deterministic failure to apply to the wrong provider, while the next provider returned the default mock response and obscured the fallback provenance assertion.

**How to apply:** Mark non-target providers unavailable in the lifecycle mock, make the target provider fail deterministically, and start from a queued execution with its manifest persisted when the test should assert exactly one terminal acceptance. Avoid reconciling an already-claimed execution unless the test specifically needs to cover lease-expiry acceptance.