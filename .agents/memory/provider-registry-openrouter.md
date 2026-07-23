---
name: Provider Registry & OpenRouter
description: Architecture decisions for adding OpenRouter as a third AI provider via a registry pattern.
---

# Provider Registry & OpenRouter

## Rule
Adding any future provider requires only one entry in `lib/ai-orchestrator/src/provider-registry.ts` (PROVIDER_REGISTRY + PROVIDER_PRIORITY array). No if/else chains to update in routes or agents.

**Why:** The previous groq/deepseek dual-hardcoding created drift across 7+ call sites. The registry centralizes provider metadata; all consumers iterate PROVIDER_PRIORITY.

## How to apply
- Fallback order is `PROVIDER_PRIORITY = ["openrouter", "deepseek", "groq"]` — openrouter wins when configured.
- Transport: groq uses groq-sdk (circuit-breaking + retries built in); deepseek and openrouter both use `openai-compatible-client.ts` (generic fetch, no internal retries).
- Key management: canonical route is `/api/ai/providers/:provider/key`; per-provider aliases (/groq-key, /deepseek-key, /openrouter-key) delegate to the same handler in providers.ts.
- OpenAPI enum at `ActiveProviderStatus.provider` must include all three values; run `pnpm codegen` after openapi.yaml changes.
- Dashboard: `OpenRouterKeyCard` uses `/api/ai/openrouter-key` alias; cards rendered in priority order (OpenRouter → DeepSeek → Groq).

## Key files
- `lib/ai-orchestrator/src/provider-registry.ts` — single source of truth for provider metadata + PROVIDER_PRIORITY
- `lib/ai-orchestrator/src/openai-compatible-client.ts` — generic OpenAI-compatible fetch transport
- `artifacts/api-server/src/lib/ai-route-helpers.ts` — resolveProvider/resolveFallbackProvider iterate PROVIDER_PRIORITY
- `artifacts/api-server/src/routes/ai/providers.ts` — generic :provider route + backward-compat aliases
- `lib/api-spec/openapi.yaml` — enum + OpenRouterKeyStatus/ProviderKeyStatus schemas
