---
name: Mission approval adapter
description: Approval waits reuse the existing proposal approval gate and resume the Mission runtime without a parallel approval ledger.
---

The Mission approval boundary is a thin adapter over the existing server-owned `aiChangeProposals` approval gate. It must lock and verify the Goal, Mission owner/project, linked execution, proposal status, `approvalRequired`, and exact proposal revision in one transaction; after clearing the gate it resumes through `runMissionGoal`. Applying files remains a separate guarded operation.

Every transaction that locks both a Mission and one of its Goals must acquire Mission before Goal. Reconcile, approval, completion, and status-mutation paths share this order; pre-reads do not replace revalidation under both locks.

**Why:** Opposite lock order in approval and wait-reconciliation transactions reproduced concurrent request failures. A second approval table or direct apply path would also create a competing source of truth and bypass the existing candidate, revision, delivery, and acceptance protections.

**How to apply:** Lock Mission, then Goal, before changing both rows. Keep proposal-backed approvals separate from plan revision approval and generic external events. Bind executions to their Mission Goal when creating task executions so the adapter can resolve the proposal server-side.

The Apply Mission handoff shares the proposal row with Goal approval, so it must lock project Missions before locking the proposal. A non-locking proposal-existence read may precede those locks; the proposal must be locked and revalidated afterward. Once that proposal lock is held, re-read Missions without taking reverse-order row locks so another handoff that committed while this transaction waited is still detected as a duplicate.

**Why:** The inverse proposal-before-Mission ordering reproduced an HTTP 500 under a forced concurrent interleaving. A simple lock-order swap can weaken same-proposal duplicate detection if the Mission scan began before another request inserted its Apply Mission; the proposal row serializes those requests, and the post-lock read observes the winner.

**How to apply:** Preserve Mission-before-proposal locking and the fresh post-proposal duplicate read whenever changing Apply Mission creation or proposal-backed Goal approval.