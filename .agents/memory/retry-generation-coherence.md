---
name: Retry generation coherence
description: Durable test-model guidance for retry tokens, request drift, and adaptive generation changes.
---

Retry recovery tests should model token generations and request generations as separate state, then exercise drift, restoration, rotation, and replay in adaptive sequences. A claim is valid only when the token is current for the exact request bytes that passed recovery checks; a token from an earlier generation must remain rejected even if the request is later restored.

**Why:** Testing each mutation in isolation misses mixed-generation failures where a stale token and a restored or rotated request accidentally form an accepted pair.

**How to apply:** Keep schedules deterministic and label every step and claim result. After each rejection, inspect durable state and continue from the observed state rather than assuming a fixed interleaving; assert attempt/status invariants as well as the final claim vector.