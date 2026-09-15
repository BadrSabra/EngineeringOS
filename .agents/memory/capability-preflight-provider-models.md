---
name: Capability preflight provider model isolation
description: Capability preflight must never use a model identifier from another provider during structured-output validation.
---

Capability preflight model selection is provider-scoped across every probe call, including the no-tools structured-output leg; a global OpenRouter fallback must not be sent to Gemini, Groq, or another provider.

**Why:** A live probe reached Gemini's native tool check, then its structured-output check defaulted to an OpenRouter free-model ID and received a 404. The provider was rejected before any source read or evidence recovery could begin.

**How to apply:** Resolve an explicit provider-owned model before both probe legs, preserve provider/model identity in failure telemetry, and add a regression that fails if a non-OpenRouter probe emits an OpenRouter catalog ID.