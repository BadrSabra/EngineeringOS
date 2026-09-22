---
name: Mission approval adapter
description: Approval waits reuse the existing proposal approval gate and resume the Mission runtime without a parallel approval ledger.
---

The Mission approval boundary is a thin adapter over the existing server-owned `aiChangeProposals` approval gate. It must lock and verify the Goal, Mission owner/project, linked execution, proposal status, `approvalRequired`, and exact proposal revision in one transaction; after clearing the gate it resumes through `runMissionGoal`. Applying files remains a separate guarded operation.

**Why:** A second approval table or direct apply path would create a competing source of truth and bypass the existing candidate, revision, delivery, and acceptance protections.

**How to apply:** Keep proposal-backed approvals separate from plan revision approval and generic external events. Bind executions to their Mission Goal when creating task executions so the adapter can resolve the proposal server-side.