---
name: Structured execution adapter
description: Durable lifecycle rules for Analyze and Review structured SSE tasks
---

Structured Analyze/Review routes use a narrow adapter over the shared execution ledger: reserve and claim before provider work, checkpoint bounded stages, persist the assistant row with execution identity, then finalize success or failure before emitting the terminal task event. A client EOF is a recoverable transport condition; status/history reconciliation decides the outcome.

**Why:** Structured routes previously bypassed durable execution, so provider failures and client disconnects lost execution identity and successful results were only local UI state.

**How to apply:** Keep provider-specific orchestration in the route, but do not bypass the adapter for new structured tasks. Deduplicate the user prompt on retry, preserve owner-scoped sessions, and never create a resume session before validating the existing execution.