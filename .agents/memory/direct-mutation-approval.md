---
name: Direct mutation approval boundary
description: How direct file-change requests are routed safely before an approved Build handoff.
---

Direct mutation requests must become a read-only implementation plan with `PENDING_APPROVAL` and `NOT_AUTHORIZED` before any write-capable tool path is available. The plan classification must be the same classification used for filesystem planning, model/tool selection, SSE proof requirements, and the dashboard projection.

**Why:** A direct request that remains a write-capable `DELIVERY` turn can reach the write authorization gate without creating the plan/proposal UI state, leaving the operator with only a generic tool failure and no approval action.

**How to apply:** Preserve the exception for server-owned approved Build handoffs and compound inspect-then-change proposals. Keep plan-mode turns out of `isWriteCapableTurn` and out of proof-required execution acceptance, while retaining the fail-closed session/approval guards for actual execution commands.