---
name: AI fixture provider lifecycle
description: Provider-free deterministic chat tests that exercise real fallback code need lifecycle acceptance for their dummy provider.
---

Deterministic chat fixtures that retain the real fallback helper must stub the lifecycle result as selectable for the fixture provider, not only stub the provider strategy or initial provider resolver.

**Why:** The fallback helper re-collects configured providers and validates the supplied initial provider before entering the real chat/tool loop; a dummy key is otherwise rejected even though the strategy is mocked.

**How to apply:** In provider-free repair-loop or tool-chat fixtures, keep production credential and lifecycle guards intact, and override only the fixture lifecycle decision plus the deterministic strategy.