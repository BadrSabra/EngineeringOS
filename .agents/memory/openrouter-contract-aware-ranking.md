---
name: OpenRouter contract-aware ranking
description: Constraints for using server-accepted task outcomes to order free model lanes.
---

Adaptive model ordering may learn only from signals bound to an exact model and exact server-owned task contract. Server-validated accepted/rejected outputs measure task quality; typed non-empty/empty responses measure content availability separately. Provider HTTP success alone, timeout, `429`, quota, cancellation, and unvalidated model claims are not contract-acceptance samples. The score is advisory and process-local; it cannot establish proof, authorize a model, widen the free catalog, or change terminal rate-limit behavior.

**Why:** A completion can return content but fail the task contract, while an empty response has no task-quality verdict. `429` is an admission signal, not model quality, and the existing policy forbids speculative cooldowns or cross-model retries.

**How to apply:** Record accepted/rejected outcomes only at an existing server-owned acceptance gate; record content presence separately at the provider boundary. Keep ranking within equally eligible free models for that exact contract, preserve exploration and fallback order, and keep `429`/`QUOTA` terminal for the current request. Add durable shared scores only with explicit freshness, ownership, and migration review.
