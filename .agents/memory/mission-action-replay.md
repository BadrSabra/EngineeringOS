---
name: Mission action replay
description: Idempotent retries across legacy Mission lifecycle routes.
---

Agent-aware compatibility routes must route requests with a complete expected-decision and idempotency identity to the unified ledger before status-based fallback. A successful action may change the Mission state before its client retries, and route classification based only on current state can bypass replay. Route-specific targets must be part of the request identity, and replay should preserve the original HTTP response status.

**Why:** Starting a draft changes it to active; a retry can otherwise look like a normal active-Mission update rather than the same Agent action.

**How to apply:** In lifecycle adapters, dispatch a complete action identity before checking the current projection; keep route targets in the hashed input and store response status alongside the durable result.

Mutation transactions must store a safe effect receipt in the owning action event before commit, fenced by request hash and claim identity. AUTO_CONTINUE must receipt every runtime return, including blocked, waiting, and conflict outcomes, because those branches can still persist Goal or Mission state. The post-commit result stage must lock and merge the current payload so it cannot erase the receipt. Never store plaintext recovery capabilities.

**Why:** A process can fail after a business effect commits but before the separate result-stage write; even a rejected continuation may have changed lifecycle state. Co-committing the receipt prevents an unrecorded effect, while merging the latest payload preserves it for recovery.

**How to apply:** Each mutating action service writes its normalized result receipt in its business transaction; wrap Mission Runtime's full decision callback so non-success returns are included too. Then stage the full response under a row lock and terminalize with claim/status predicates; replay prefers the full result and falls back to a validated receipt.
