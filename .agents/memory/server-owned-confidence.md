---
name: Server-owned confidence
description: Confidence must be computed from accepted evidence and objective state
---

Confidence is a server projection, not a provider verdict. Compute it from evidence completeness, closed/accepted claim coverage, source diversity, revision equality, contradiction absence, and objective closure. A complete single-file implementation remains limited; implementation plus tests plus an accepted projection can be high. Any stale revision or contradiction must prevent a PROVEN confidence level.

**Why:** Provider confidence and evidence relevance alone can look high while the objective is incomplete, stale, single-sourced, or contradicted.

**How to apply:** Keep the factor breakdown in the public result, use the same projection for JSON and SSE, and let optional model suggestions remain informational only.