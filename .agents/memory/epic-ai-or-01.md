---
name: EPIC-AI-OR-01 — Dynamic OpenRouter Model Resolution
description: Free-tier model catalog, resolver, automatic 404 fallback, resolved-model display, provider registry Story-07.
---

# EPIC-AI-OR-01 — Implementation complete (2026-08-02)

## Root cause fixed
`google/gemma-2-9b-it:free` was hardcoded in provider-registry.ts — it returned 404 (discontinued).

## Files created
- `lib/ai-orchestrator/src/openrouter/model-catalog.ts` — `FREE_MODELS` array, `OpenRouterFreeModel` type, ~10 models
- `lib/ai-orchestrator/src/openrouter/model-resolver.ts` — `resolveModel`, `resolveFallbackChain`, `buildFallbackChainFromId`, `emitModelDecisionTrace`
- `lib/ai-orchestrator/src/openrouter/index.ts` — barrel re-export

## Key decisions
- **No hardcoded model IDs in registry (Story-07):** `_orFast`/`_orPowerful` computed at module load via `resolveFallbackChain()`.
- **404 → MODEL_NOT_FOUND in classifyStatus:** only fires when `providerName === "OpenRouter"` to avoid false positives on other providers.
- **Fallback is internal to `openrouterCompleteWithFallback`:** strategies and agent-complete don't need to know about chains.
- **`resolveFallbackChain` (pure)** used at registry startup; **`resolveModel` (logs trace)** used at per-request call sites.
- **Streaming path keeps single-try:** fallback only applies to non-streaming tool loop.
- **`ResolvedModelInfo` in `ChatOutputSchema`:** optional field, added via `.extend()` — `.strict()` base is unaffected.

## Why
- `buildFallbackChainFromId` places same-quality peers first, then opposite quality tier — so the degradation is gradual.
- `emitModelDecisionTrace` fires once per resolved call; `openrouter-fallback` scope logs each skip.

## Story completion
- Story-01: `model-resolver.ts` — `resolveModel` + `resolveFallbackChain` ✓
- Story-02: capability-based mapping in `resolveFallbackChain` ✓
- Story-03: automatic fallback in `openrouterCompleteWithFallback` ✓
- Story-04: `resolvedModel` surfaced to dashboard badge in `AiChat.tsx` ✓
- Story-05: `emitModelDecisionTrace` + `scope:"openrouter-fallback"` logs ✓
- Story-06: `model-catalog.ts` separates metadata from registry ✓
- Story-07: registry computes model IDs via `resolveFallbackChain` ✓
