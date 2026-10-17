---
name: Mission approval adapter
description: Approval waits reuse the existing proposal approval gate and resume the Mission runtime without a parallel approval ledger.
---

The Mission approval boundary is a thin adapter over the existing server-owned `aiChangeProposals` approval gate. It must lock and verify the Goal, Mission owner/project, linked execution, proposal status, `approvalRequired`, and exact proposal revision in one transaction; after clearing the gate it resumes through `runMissionGoal`. Applying files remains a separate guarded operation.

Every transaction that locks both a Mission and one of its Goals must acquire Mission before Goal. Reconcile, approval, completion, and status-mutation paths share this order; pre-reads do not replace revalidation under both locks.

**Why:** Opposite lock order in approval and wait-reconciliation transactions reproduced concurrent request failures. A second approval table or direct apply path would also create a competing source of truth and bypass the existing candidate, revision, delivery, and acceptance protections.

**How to apply:** Lock Mission, then Goal, before changing both rows. Keep proposal-backed approvals separate from plan revision approval and generic external events. Bind executions to their Mission Goal when creating task executions so the adapter can resolve the proposal server-side.