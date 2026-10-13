---
name: OpenRouter BYOK scope
description: Distinguish OpenRouter authentication from BYOK routing to an upstream model provider.
---

OpenRouter error metadata such as `is_byok=false` describes whether the upstream model provider was reached through a customer-owned provider key; it does not establish whether the request itself authenticated to OpenRouter with a user or project key. Diagnose rate limits from `limit_source`, `provider_name`, and the raw provider message.

**Why:** A Poolside shared-pool 429 included `is_byok=false` and a suggestion to add a provider key; reading that as “no OpenRouter key was used” would misidentify the failing credential boundary.

**How to apply:** Keep OpenRouter account authentication, upstream-provider BYOK routing, and shared-pool rate limits as separate concepts in logs and user-facing diagnoses.
