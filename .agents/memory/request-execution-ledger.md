---
name: Request execution ledger
description: Why AI request budgets must remain separate from evidence integrity state.
---

Use one request-owned execution ledger across provider fallback, planning, tool loops, hierarchical children, synthesis, recovery, and provider-owned retries. Every physical provider attempt must be admitted before it starts, and its timeout/backoff must be bounded by the request's absolute deadline and cancellation signal.

**Why:** Local per-loop limits allow retries and nested orchestration to multiply latency and work. The evidence RunLedger answers a different question—what was proven—and combining the two would blur safety and audit semantics.

**How to apply:** Thread the same execution ledger through every nested AI phase and provider attempt. Provider clients should derive their signal from the ledger when no separate signal is supplied, and preserve completed evidence when a later retry is rejected; budget exhaustion must never become a proven outcome.

Optional one-shot phases such as query planning must not poison later provider fallback: if planning was already admitted, a fallback attempt should reuse the bounded fallback plan or skip planning without terminalizing the shared ledger. A rejected optional planner admission must not be reported as a model-budget failure that blocks the next provider.

An admission rejected after the absolute wall-clock deadline must be classified as `deadline` even if the abort timer has not fired yet; tool dispatch must project that state as incomplete evidence, not as a tool-budget failure.

**Why:** A provider response can arrive just after the deadline and still contain a queued tool call. Misclassifying its admission rejection as `tool_budget` turns a time-bounded incomplete analysis into a misleading `TOOL_EXECUTION_FAILED`.

**How to apply:** Check the ledger's terminal reason before converting a rejected tool admission into a failed tool result, and preserve the incomplete evidence state for the route's terminal projection.

Provider-attempt completion events must retain the exact budget reservation ID, and the bounded event history must be sized to cover the ledger's admitted attempt budget. Telemetry projections must read identity from the matching completion event rather than pairing separate arrays by position.

**Why:** Event truncation or out-of-order completion can otherwise detach telemetry from the reservation that paid for the physical request or tempt callers to invent a replacement identity.

**How to apply:** When changing provider-attempt limits, keep event retention large enough for all admitted starts/completions; carry the reservation ID through completion and project it directly into durable telemetry.