---
name: Request execution ledger
description: Why AI request budgets must remain separate from evidence integrity state.
---

Use one request-owned execution ledger across provider fallback, planning, tool loops, hierarchical children, synthesis, recovery, and provider-owned retries. Every physical provider attempt must be admitted before it starts, and its timeout/backoff must be bounded by the request's absolute deadline and cancellation signal.

**Why:** Local per-loop limits allow retries and nested orchestration to multiply latency and work. The evidence RunLedger answers a different question—what was proven—and combining the two would blur safety and audit semantics.

**How to apply:** Thread the same execution ledger through every nested AI phase and provider attempt. Provider clients should derive their signal from the ledger when no separate signal is supplied, and preserve completed evidence when a later retry is rejected; budget exhaustion must never become a proven outcome.