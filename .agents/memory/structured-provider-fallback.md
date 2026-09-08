---
name: Structured provider fallback
description: Provider and model fallback behavior for structured Analyze/Review requests
---

A resolved OpenRouter fallback chain is only a candidate list. Structured Analyze/Review calls must explicitly pass the bounded transient-fallback policy to the model client; otherwise a 429 is retried or surfaced on the first model and the remaining chain is unused. Provider-level telemetry also does not automatically capture internal model attempts.

**Why:** A real structured run selected a multi-model chain but produced one RATE_LIMITED usage row and no model fallback because retryTransient was not enabled at the agent boundary.

**How to apply:** Keep transient fallback bounded, preserve Retry-After safety, bind every provider/model attempt to the durable execution and operation, and test first-model 429 → next-model success plus exhausted-chain terminal behavior.