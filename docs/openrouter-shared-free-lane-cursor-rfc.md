# RFC: Shared Fair Rotation for OpenRouter Free Lanes

**Status:** Shared rotation implemented; rollout review required. See `docs/free-only-ai-execution-plan.md` for the broader zero-paid execution policy.
**Scope:** Cross-process selection of eligible OpenRouter free models
**Validation:** Drizzle schema and product routing are implemented locally; schema application and concurrency checks were run only against a disposable loopback PostgreSQL instance. No Development/Production database or live provider request was used.

## Decision record and rollout status

The shared PostgreSQL cursor is implemented locally for new, unpinned requests across equally preferred free-model lanes. This RFC records its intended behavior and validation boundary; it does not claim production rollout or permanent provider availability.

This improves distribution. It cannot create upstream capacity or guarantee that another free model avoids the same shared-pool limit.

## Existing behavior

- The resolver filters OpenRouter candidates by the free catalog and requested capability. Explicitly pinned models remain pinned and are validated.
- Unpinned requests reserve a shared cursor slot for the highest-ranked eligible lane group. Contract-aware weights affect that rotation when accepted outcome and availability data exist.
- The API client filters model-specific cooldowns before attempting models. Positive, provider-supplied `Retry-After` is persisted with the verified scope; successful responses clear the relevant model cooldown.
- A 429 is terminal for the current request. It does not advance that request to another model. When `Retry-After` is absent or zero, `RATE_LIMITED` receives a bounded, persisted local adaptive cooldown on the exact model; this is admission protection, not a provider recovery estimate. `QUOTA` does not receive a synthetic cooldown.
- If shared cursor persistence is unavailable, the process-local cursor remains a best-effort fallback; cross-worker fairness is then not guaranteed.

Relevant code today: `lib/ai-orchestrator/src/openrouter/model-resolver.ts`, `model-cooldown-store.ts`, `circuit-breaker.ts`, and `lib/ai-orchestrator/src/openai-compatible-client.ts`.

## Goals

1. Keep every candidate catalog-verified and free.
2. Preserve quality ordering, capability requirements, contract weights, and pinned-model behavior.
3. Allocate distinct positions fairly when independent requests arrive concurrently at different workers.
4. Keep rate-limit handling terminal for the current request. Honor positive provider retry windows as provider evidence; keep any missing-window adaptive cooldown explicitly local and model-scoped.
5. Avoid storing prompts, credentials, project IDs, or response content in scheduler state.
6. Fail open to the existing process-local rotation if shared cursor storage is unavailable; fairness must not become an availability dependency.

## Non-goals

- Eliminating OpenRouter's shared-pool limits or promising a successful free completion.
- Retrying a 429 within the same request, bypassing quotas, rotating credentials, or using paid/other-provider fallback.
- Treating a 429 as a model-quality rejection.
- Replacing the existing model cooldown store, request execution ledger, or proof/acceptance gates.
- Persisting model-quality scores as part of this change.

## Proposed selection flow

1. Resolve the current usable catalog and filter to free models that satisfy chat, capability, tool, JSON, and streaming requirements.
2. Read active model cooldowns. Remove cooling models before scheduling, so a cursor slot is never deliberately allocated to a model already known to be unavailable.
3. Preserve the existing preference groups and contract-aware weights. Only the highest-ranked eligible group participates in fair rotation; lower-ranked groups remain ordered fallbacks for the existing non-rate-limit cases.
4. For two or more eligible models in that group, atomically reserve one weighted slot from the shared cursor. Use the selected model as primary and retain the current deterministic fallback ordering.
5. A single candidate needs no cursor operation. Explicitly pinned requests remain pinned and do not advance the shared cursor.
6. A selected lane consumes its slot even if that provider attempt later returns 429. That affects only the starting lane of a later independent request; it never authorizes a same-request retry.

### Cursor identity and storage

Add a separate, additive table rather than overloading `openrouter_model_cooldowns`. Conceptual fields:

- `cursor_key`: opaque hash of server-owned lane dimensions.
- `candidate_set_hash`: hash of the ordered eligible lane IDs and weights.
- `next_slot`: non-negative integer in the weighted rotation range.
- `updated_at`: timestamp for stale-row cleanup.

The lane dimensions include provider, capability, quality group, required tool/JSON/streaming flags, server-selected task type/contract, and a scheduler-policy version. The candidate-set hash prevents a changed catalog or changed weights from reusing an incompatible position. Neither key contains prompt or user content.

Use a single PostgreSQL upsert/update-returning operation so concurrent workers reserve distinct slots atomically. The returned slot is mapped through the existing weighted-selection function. Candidate sets with one model bypass persistence. Old cursor rows may be pruned after an operationally chosen retention period; this is storage cleanup only, not a model cooldown.

Keep the existing in-memory cursor as the fallback when persistence fails. Emit a rate-limited, sanitized diagnostic that shared coordination is unavailable; do not turn database trouble into an AI request failure.

## Invariants and failure behavior

| Condition | Required behavior |
|---|---|
| Positive `Retry-After` on shared-pool 429 | Persist cooldown for the exact attempted model; skip it on future requests until expiry. |
| Missing/zero `Retry-After` on `RATE_LIMITED` | Persist the bounded local adaptive cooldown for the exact model only; do not expose it as a provider ETA or extend it to siblings. |
| Missing/zero `Retry-After` on `QUOTA` | Do not invent a cooldown or retry time; keep the typed quota outcome terminal. |
| Any 429 in current request | Terminal for that request; no same-request model advancement, tool-loop retry, or paid promotion. |
| All eligible free models cooling | Keep the existing typed rate-limited outcome and provider-derived retry estimate. |
| Catalog refresh failure | Keep current catalog fail-safe behavior; never admit paid or stale IDs as free. |
| Cursor store unavailable | Continue with process-local rotation; do not fail the user request or claim cross-process fairness. |
| Candidate-set hash changes | Start a cursor for the new set; never choose a model outside the just-validated eligible set. |
| Provider success | Keep existing exact-model cooldown clearing and server-owned acceptance rules. |

Fair rotation is a fairness mechanism, not a health signal. `RATE_LIMITED`, `QUOTA`, empty output, and task acceptance remain distinct measurements.

## Test plan

### Pure unit tests

1. Repeated selections over an equal-ranked free group cycle through each lane.
2. Weighted selections preserve the current contract-weighted distribution.
3. Pinned model selection does not touch the cursor.
4. Candidate-set or policy-version changes use an independent cursor key.
5. Paid, stale, or capability-ineligible candidates never enter the scheduling set.
6. Cooling models are removed before slot reservation.
7. Missing/zero delay creates only the documented local adaptive `RATE_LIMITED` cooldown; `QUOTA` gets none. Positive provider delays retain their classified scope.

### PostgreSQL concurrency tests

Use a disposable loopback-only PostgreSQL cluster and the project's Drizzle schema path:

1. Issue concurrent reservations from independent database connections against one cursor key; verify each returned slot is unique modulo the slot count and no reservation is lost.
2. Repeat with a second cursor key to prove capability/contract lanes do not contend.
3. Change candidate-set hash while requests are in flight; verify every selected index is in range for the set used by that request.
4. Force persistence read/write failures; verify requests still use local rotation and no raw prompt, credential, or project identity is written.
5. Verify expired cursor-row cleanup cannot change active model cooldown rows.

### Client/route contract tests

1. A first lane returns 429: the current request ends with the classified rate-limit outcome and makes one provider attempt.
2. The next independent unpinned request starts from the next shared slot.
3. A positive provider retry window excludes the affected model/scope across workers; missing-window local adaptive cooldowns remain distinguishable and never become provider-supplied retry times.
4. No test or adapter can reach a paid model or non-OpenRouter provider while OpenRouter free-only mode is active.
5. Preserve terminal SSE/HTTP metadata, including safe rate-limit scope and positive retry delay only.

No live-provider call is needed to validate these invariants. A later live smoke is a separate, explicitly controlled check and must record the actual model selected.

## Rollout gates

1. Review the local implementation, cursor scope, retention implications, and additive schema contract.
2. The cursor store, free-lane scheduling, local fallback, and application-schema contract are implemented. Disposable PostgreSQL schema and concurrency validation passed; this does not prove Development readiness.
3. The tool loop reserves once and pins subsequent calls to the returned actual model. Explicit model choices remain pinned, and the shared cursor does not authorize same-request 429 retries or paid fallback.
4. Before enabling the feature in a deployed API, apply the schema through the approved Development workflow and verify startup/schema compatibility. Do not apply to Production as part of this change.
5. A live free-provider smoke, if desired, is a separate explicitly approved check. It must report the actual selected model and cannot establish permanent free-tier availability.

## Acceptance criteria for implementation

- Concurrent independent unpinned requests across at least two API workers distribute their starting lane according to the eligible weighted schedule.
- Every selected model is verified free and capability-compatible at selection time.
- A 429 never advances the current request to another model; a later independent request may use the next free lane.
- Provider-supplied retry windows remain distinguishable from exact-model local adaptive cooldowns; no cooldown is invented for `QUOTA`.
- Cursor-store outages do not fail AI requests, and all fallback diagnostics are sanitized.
- No regression in proof, acceptance, task, or delivery gates.
