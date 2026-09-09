---
name: SSE recovery authority
description: Long AI streams need transport keepalive and durable status reconciliation after the browser loses SSE.
---

SSE keepalive protects the browser/proxy connection, but it is not execution ownership. After EOF or a stream reset, the durable execution status and acceptance decision remain authoritative; the client must reconcile from them before offering resume or starting a new run. A missing acceptance must not be projected as a synthetic terminal failure.

**Why:** A provider/tool call can outlive the browser connection. Treating EOF as terminal can hide a completed server result, while treating every failed status as resumable can offer an invalid recovery action. Synthetic failure projections make a running execution look terminal and obscure the real persistence or ownership failure.

**How to apply:** Keep transport heartbeats separate from worker lease heartbeats, clear only ephemeral stream activity on reset, refresh execution status/history, and derive recovery actions from the canonical acceptance `nextActionCode` plus `resumable` flag. Keep status, history, and message projections on the same acceptance-derived recovery decision.