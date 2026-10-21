---
name: Direct mutation approval boundary
description: How direct file-change requests are routed safely before an approved Build handoff.
---

Direct mutation requests must become a read-only implementation plan with `PENDING_APPROVAL` and `NOT_AUTHORIZED` before any write-capable tool path is available. The plan classification must be the same classification used for filesystem planning, model/tool selection, SSE proof requirements, and the dashboard projection. Typed implementation-plan results are executable handoff metadata and may only survive on an explicitly authorized `DELIVERY` turn; read-only project questions must strip them from new assistant projections.

**Why:** A direct request that remains a write-capable `DELIVERY` turn can reach the write authorization gate without creating the plan/proposal UI state, leaving the operator with only a generic tool failure and no approval action. Historical approved plans are context, not authorization, so provider-returned plan metadata must not revive an executable state on a read-only turn.

**How to apply:** Preserve the exception for server-owned approved Build handoffs and compound inspect-then-change proposals. Keep plan-mode turns out of `isWriteCapableTurn` and out of proof-required execution acceptance, while retaining the fail-closed session/approval guards for actual execution commands. Do not project `IMPLEMENTATION_PLAN_RESULT` from provider output unless the current turn is `DELIVERY`.

Model-authored implementation plans always enter persistence as `PENDING_APPROVAL` and `NOT_AUTHORIZED`. Only the guarded, one-shot server decision transition may set `APPROVED` and `APPROVED_FOR_BUILD`.

**Why:** The persisted approval pair is consumed by Build Mode; accepting those fields from model output would let a generated plan bypass the separate approval transition.

**How to apply:** Normalize at both the planner output and API persistence boundary. Build eligibility must still depend on the server-mutated stored state and its existing identity, scope, and context checks.

Full-lifecycle acceptance tests must report a stage-specific blocker when existing server-owned approval or tool policy prevents candidate generation. They must not widen production permissions, seed acceptance or approval, or fake delivery to make the journey pass.

**Why:** The acceptance journey must measure the supported runtime rather than grant itself the capabilities it is meant to verify.

**How to apply:** Keep deterministic provider fixtures inside the existing authorized tool manifest. If no approved path reaches candidate creation, stop at that stage and report the compatibility gap.