---
name: Request execution ledger
description: Why AI request budgets must remain separate from evidence integrity state.
---

Use one request-owned execution ledger across provider fallback, planning, tool loops, hierarchical children, synthesis, and recovery. Every fresh attempt must be admitted before it starts, and its timeout must be capped by the request's absolute deadline.

**Why:** Local per-loop limits allow retries and nested orchestration to multiply latency and work. The evidence RunLedger answers a different question—what was proven—and combining the two would blur safety and audit semantics.

**How to apply:** Thread the same execution ledger through every nested AI phase and provider attempt. Preserve completed evidence when execution budget is exhausted, and do not let budget exhaustion convert an incomplete result into a proven outcome.