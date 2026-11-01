---
name: Mission lifecycle continuity index
description: Navigation for Mission, Goal, execution, approval, recovery, and world-state continuity decisions.
---

Use this index when changing product-level Mission lifecycle behavior. Keep authorization, proof, recovery, and delivery gates on the existing Mission Runtime rather than creating parallel lifecycle mechanisms.

- [Mission plan materialization](mission-plan-materialization.md) — materialize typed steps as durable Goals; let the existing runtime gate dependencies and wake downstream work.
- [Mission recipe claim transaction](mission-recipe-claim-transaction.md) — keep Mission/Goal authorization, paused-resume token recovery, and recipe claim atomic.
- [Engineering Agent control-plane scope](engineering-agent-control-plane.md) — preserve product continuity over the existing Mission Runtime and its scoped approval/delivery gates.
- [Mission action replay](mission-action-replay.md) — retries reach the unified ledger before mutable lifecycle state is re-evaluated.
- [Automatic Mission replan](mission-auto-replan.md) — replan is revision-bound; server-owned diagnoses may block recovery but never grant scope.
- [Mission replan test isolation](mission-replan-test-isolation.md) — inject a fake root-goal runner so integration tests do not persist recoverable tasks.
- [Workflow phase ledger](workflow-phase-ledger.md) — phase status is bookkeeping, not Canonical Proof; nonempty work needs bound evidence.
- [Task execution lifecycle](task-execution-lifecycle.md) — preserve live worker leases and keep Mission content revisions separate from metadata timestamps.
- [Mission management browser proof](missions-management-browser-proof.md) — verify base-aware navigation and durable selection after reload.
- [Mission projection polling](mission-projection-polling.md) — the active-Mission refresh interval is intentional unless the product contract changes.
- [Mission approval adapter](mission-approval-adapter.md) — use Mission-first locking and pin the locked Proposal identity to Apply Mission.
- [Workflow Mission adapter](workflow-mission-adapter.md) — project workflow acceptance through the shared Goal/Mission seam; empty phases remain valid.
- [Mission tool-loop profile](mission-tool-loop-profile.md) — server-owned plan steps select profiles; legacy tasks retain TaskAgent behavior.
- [Mission replan context](mission-replan-context.md) — persist bounded failure evidence and affected claims in the fresh plan revision.
- [Mission world-state projection](mission-world-state-projection.md) — bounded state flows checkpoint → receipt → Goal acceptance; provider prose is not authoritative.
