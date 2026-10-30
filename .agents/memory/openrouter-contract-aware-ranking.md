---
name: OpenRouter contract-aware ranking
description: Constraints for using server-accepted task outcomes to order free model lanes.
---

Adaptive model ordering may learn only from server-evaluated outcomes bound to an exact model and exact task contract. Provider HTTP success, empty output, timeout, `429`, quota, cancellation, and unvalidated model claims are not contract-acceptance samples. The score is advisory and process-local; it cannot establish proof, authorize a model, widen the free catalog, or change terminal rate-limit behavior.

**Why:** A completion can be transport-successful but fail the task contract, while provider availability failures do not measure task quality. Mixing these signals would misroute requests or silently weaken the existing fail-stop behavior.

**How to apply:** Record accepted/rejected outcomes only at an existing server-owned acceptance gate. Keep ranking within equally eligible free models for that exact contract, preserve exploration and fallback order, and keep `429`/`QUOTA` terminal for the current request. Add durable shared scores only with explicit freshness, ownership, and migration review.
