---
name: Live provider smoke preflight
description: Distinguish harness initialization failures from OpenRouter outcomes before attributing rate limits or empty responses.
---

A live smoke can fail before any model request when a plain Node launcher cannot load a workspace package exported as TypeScript source. The runner may report the provider or catalog as unavailable while the model-attempt count remains zero; that is not evidence of a provider throttle or an empty model response.

**Why:** A live smoke launched with plain Node failed during TypeScript module loading with zero model attempts. An offline import through the workspace TypeScript executor succeeded, and the subsequent single free-model request passed.

**How to apply:** Prove imports with provider egress disabled first. Run the live smoke through the workspace TypeScript executor, and classify RATE_LIMITED or EMPTY_RESPONSE only after confirming a model request was attempted. Keep the authorized attempt limit and free-only policy intact.
