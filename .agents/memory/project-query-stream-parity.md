---
name: Project-query stream parity
description: Durable rule for keeping targeted project-query acceptance consistent across direct SSE, native SSE, and non-streaming paths.
---

Targeted PROJECT_QUERY objectives must apply the server-owned response override and materialized claim evidence before any transport-specific terminal gate or early return. The direct SSE path must not validate only the provider response and generic behavioral evidence.

**Why:** A live OpenRouter direct-content run retained every required source body and materialized all claims, but its early SSE return sent the provider candidate through the generic gate first. The shared non-streaming closure path was never reached, so complete evidence became `acceptedClaimCount=0` and `NO_ANSWER`.

**How to apply:** Build one project-query acceptance projection from the materialized evidence, then feed that same response/evidence pair to direct SSE, native SSE, and non-streaming gates. Add a regression for each transport, including a provider-empty/incomplete case that must remain incomplete.

PROJECT_QUERY must not emit generic `forensic_terminal` steps from any transport-specific degradation or synthesis seam. Its source-backed analysis contract is accepted by objective closure; a later `NO_EVIDENCE_FOUND` or similar forensic terminal makes the API acceptance layer reject an otherwise proven result.

**Why:** A complete embedded-AI query reached `PROVEN` with three accepted claims, but direct/native SSE emitted a generic forensic terminal before final projection. The API correctly treated that contradictory trace as incomplete, producing `NOT_RECORDED` rather than accepting the evidence.

**How to apply:** Guard every `relayForensicTerminal` call with the turn kind, not only the final non-streaming seam. Keep the API validator fail-closed for genuinely conflicting forensic traces.