---
name: OpenRouter free-only routing
description: Product-level constraint for model selection, fallback, and rate-limit behavior.
---

EngineeringOS product traffic to OpenRouter must use catalog-verified free models only. A paid or stale model ID in environment configuration is a hint to ignore, not permission to spend. A 429 or QUOTA response ends model advancement for that request regardless of its classified scope. New unpinned requests may rotate among equally ranked free lanes; do not invent cooldown durations or retry ETAs.

**Why:** the user explicitly chose to remain on free OpenRouter models while addressing rate limits.

**How to apply:** when an OpenRouter credential is configured, keep provider selection, fallback, and refreshed candidate lists on OpenRouter; fail closed if no eligible free model is available instead of silently using another provider. With no OpenRouter credential, preserve existing provider routing. Enforce catalog-verified free model IDs at every OpenRouter entrypoint, and add offline tests proving paid pins are ignored and 429/QUOTA never triggers paid promotion.
