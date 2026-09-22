---
name: General task planning
description: Durable rules for coordinating existing task, query, and capability plans without creating competing execution state.
---

The general planning layer is an adapter and decision point, not a fourth planner or execution engine. A durable execution plan has priority over a persisted project-query scope, which has priority over a provider-created query plan. Reuse requires the current workspace revision to match; otherwise create a new plan or remain read-only until scope is resolved.

**Why:** Multiple planning systems already own different responsibilities. Replanning during resume or execution handoff can create conflicting scopes, duplicate work, or make an old revision appear current. Planning completion is never execution success and cannot authorize mutation.

**How to apply:** Keep one request budget and execution ledger. Emit a bounded plan/reuse trace without provider reasoning. Let existing execution nodes, recipe compilation, coordinators, approval gates, validation, and acceptance remain authoritative.

The Mission adapter may expose a read-only admission preview and bind its
bounded plan snapshot to the first activation Goal, but it must not create a
second executor or grant write authority. Keep the plan hash and dependency
edges identical across the Goal's success and outcome contracts.

**Why:** A preview that differs from the first durable activation plan creates
two interpretations of the same objective and makes later recovery ambiguous.

**How to apply:** Derive both surfaces from the same server-owned preview;
defer cross-Goal dependency persistence and natural-language Mission handoff
until their ownership and consent boundaries are explicit.

The durable dependency owner is a revision-bound completion-edge table between
Goals in one Mission. `parentGoalId` remains hierarchy only; dependency writes
must validate same-Mission ownership, self-edges, and cycles before insert.

**Why:** Reusing the hierarchy field or adding a parallel graph would conflate
parentage with execution prerequisites and make replan/recovery ambiguous.

**How to apply:** Gate Goal dispatch on completed dependency Goals, keep pending
Goals in the existing waiting state, wake them through the durable dispatcher,
and preserve old revision rows when a new replan Goal is created.

Chat-to-Mission conversion is an explicit server endpoint and UI action. It
recomputes the server-owned preview, optionally binds to an owned user chat
message, rejects stale plan hashes, and only then creates an active Mission.

**Why:** Provider prose, a successful chat response, or a plan preview must not
silently grant durable execution authority.

**How to apply:** Keep ordinary Chat and Project Query paths unchanged; use the
same activation planner/runtime for the handoff, and require a fresh Mission
revision for replan rather than mutating historical Goals.