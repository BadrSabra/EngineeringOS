---
name: AI fixture provider lifecycle
description: Provider-free deterministic chat tests that exercise real fallback code need lifecycle acceptance for their dummy provider.
---

Deterministic chat fixtures that retain the real fallback helper must stub the lifecycle result as selectable for the fixture provider, not only stub the provider strategy or initial provider resolver.

**Why:** The fallback helper re-collects configured providers and validates the supplied initial provider before entering the real chat/tool loop; a dummy key is otherwise rejected even though the strategy is mocked.

**How to apply:** In provider-free repair-loop or tool-chat fixtures, keep production credential and lifecycle guards intact, and override only the fixture lifecycle decision plus the deterministic strategy.

The same fixture must also mirror the provider error serialization surface (including `toProviderContext`) and reset one-shot mock queues between tests.

**Why:** Fallback tests can otherwise fail as generic 500s or leak a deliberately queued provider rejection into the next success-path test.

**How to apply:** When adding or extending an orchestrator error mock, copy every route-consumed method from the real error class and restore the chat mock's default implementation in `afterEach`.