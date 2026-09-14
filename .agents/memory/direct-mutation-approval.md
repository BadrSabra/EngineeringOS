---
name: Direct mutation approval boundary
description: How direct file-change requests are routed safely before an approved Build handoff.
---

Direct mutation requests must become a read-only implementation plan with `PENDING_APPROVAL` and `NOT_AUTHORIZED` before any write-capable tool path is available. The plan classification must be the same classification used for filesystem planning, model/tool selection, SSE proof requirements, and the dashboard projection. Typed implementation-plan results are executable handoff metadata and may only survive on an explicitly authorized `DELIVERY` turn; read-only project questions must strip them from new assistant projections.

**Why:** A direct request that remains a write-capable `DELIVERY` turn can reach the write authorization gate without creating the plan/proposal UI state, leaving the operator with only a generic tool failure and no approval action. Historical approved plans are context, not authorization, so provider-returned plan metadata must not revive an executable state on a read-only turn.

**How to apply:** Preserve the exception for server-owned approved Build handoffs and compound inspect-then-change proposals. Keep plan-mode turns out of `isWriteCapableTurn` and out of proof-required execution acceptance, while retaining the fail-closed session/approval guards for actual execution commands. Do not project `IMPLEMENTATION_PLAN_RESULT` from provider output unless the current turn is `DELIVERY`.