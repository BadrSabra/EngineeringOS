---
name: Project-query stream parity
description: Durable rule for keeping targeted project-query acceptance consistent across direct SSE, native SSE, and non-streaming paths.
---

Targeted PROJECT_QUERY objectives must apply the server-owned response override and materialized claim evidence before any transport-specific terminal gate or early return. The direct SSE path must not validate only the provider response and generic behavioral evidence.

**Why:** A live OpenRouter direct-content run retained every required source body and materialized all claims, but its early SSE return sent the provider candidate through the generic gate first. The shared non-streaming closure path was never reached, so complete evidence became `acceptedClaimCount=0` and `NO_ANSWER`.

**How to apply:** Build one project-query acceptance projection from the materialized evidence, then feed that same response/evidence pair to direct SSE, native SSE, and non-streaming gates. Add a regression for each transport, including a provider-empty/incomplete case that must remain incomplete.