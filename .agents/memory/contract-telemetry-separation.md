---
name: Contract telemetry separation
description: Durable quality metrics for AI provider attempts and server-owned response contracts.
---

Provider transport outcome and response-contract outcome must remain separate telemetry dimensions. A successful provider call can still be malformed, incomplete, semantically failed, or citation-invalid.

**Why:** Capability-probe quality is decided by server-owned evidence and runtime facts, not by HTTP status or model-reported provenance. Combining these dimensions hides weak-model regressions and makes fallback quality impossible to measure.

**How to apply:** Record contract acceptance, claim completeness, citation matches, recovery acceptance/latency, and failure kinds on the same owner-scoped telemetry boundary as provider attempts; expose aggregate views by provider and model without persisting prompts or source contents. Project nested claims JSON into the canonical claim view before counting, and keep provider failure codes in a separate durable field rather than overloading contract failure kinds.

Recovery attempt telemetry must be emitted only after the returned content passes the applicable parse/normalization contract, and route adapters must preserve operation-scoped attempt IDs supplied by nested recovery.

**Why:** A live capability probe returned a transport-successful but malformed/incomplete recovery payload; emitting success before validation and then reusing a generic provider/attempt number allowed idempotent persistence to hide the later contract failure.

**How to apply:** Validate JSON or the bounded recovery normalizer before emitting provider success, emit contract failures as distinct attempts, and namespace attempt IDs with the recovery operation rather than overwriting them at the HTTP route boundary.

Structured-agent retries must exclude the model that returned malformed or schema-invalid output before selecting the next OpenRouter candidate; record each completed model response as its own contract-aware attempt, while transport failures remain provider attempts.

**Why:** HTTP 200 from the previous OpenRouter model was followed by a repeated call to that same weak model, then a 429; the provider transport was successful but the structured contract was not.

**How to apply:** Carry the actual response model through agent completion, pass an exclusion set into OpenRouter fallback, and emit bounded model-attempt telemetry without storing raw prompts or provider content.

Targeted project-query runs may finish with a PROVEN acceptance after provider synthesis fails, because a server-owned deterministic response is assembled from retained claim evidence. That is safe for evidence closure, but it is not provider-synthesis success.

**Why:** A completed project-query execution recorded fallback provenance and a successful evidence gate while every provider attempt retained `contractOutcome=not_applicable`, so acceptance alone could overstate model quality.

**How to apply:** Use the persisted response-source/fallback provenance and phase-specific provider attempts when tracing these runs; do not infer provider-synthesis success from a PROVEN execution acceptance.