---
name: Mission action replay
description: Idempotent retries across legacy Mission lifecycle routes.
---

Agent-aware compatibility routes must route requests with a complete expected-decision and idempotency identity to the unified ledger before status-based fallback. A successful action may change the Mission state before its client retries, and route classification based only on current state can bypass replay. Route-specific targets must be part of the request identity, and replay should preserve the original HTTP response status.

**Why:** Starting a draft changes it to active; a retry can otherwise look like a normal active-Mission update rather than the same Agent action.

**How to apply:** In lifecycle adapters, dispatch a complete action identity before checking the current projection; keep route targets in the hashed input and store response status alongside the durable result.
