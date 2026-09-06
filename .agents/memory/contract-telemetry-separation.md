---
name: Contract telemetry separation
description: Durable quality metrics for AI provider attempts and server-owned response contracts.
---

Provider transport outcome and response-contract outcome must remain separate telemetry dimensions. A successful provider call can still be malformed, incomplete, semantically failed, or citation-invalid.

**Why:** Capability-probe quality is decided by server-owned evidence and runtime facts, not by HTTP status or model-reported provenance. Combining these dimensions hides weak-model regressions and makes fallback quality impossible to measure.

**How to apply:** Record contract acceptance, claim completeness, citation matches, recovery acceptance/latency, and failure kinds on the same owner-scoped telemetry boundary as provider attempts; expose aggregate views by provider and model without persisting prompts or source contents.