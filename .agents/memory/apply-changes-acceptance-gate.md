---
name: Apply-changes acceptance gate
description: Proposal lifecycle release follows attempt-scoped effect acceptance; crash recovery must remain fail-closed.
---

Keep a proposal's Git-committable lifecycle blocked until the same execution attempt has a durable acceptance bound to an `OBSERVED` effect bundle. A source change can be physically present and its proposal status can say `applied` while lifecycle remains blocked; neither is proof that acceptance succeeded.

**Why:** Filesystem promotion, the apply journal/proposal update, and acceptance finalization cannot share one atomic transaction. A crash can leave promoted bytes without accepted effect. Git commit eligibility uses proposal lifecycle, so releasing it early could permit a commit after missing or failed proof.

**How to apply:** Release lifecycle only after effect acceptance is durably accepted. If the route crashes or the lifecycle projection update fails, retain the blocked state and return or preserve a non-success result. Recovery must use attempt-bound acceptance plus fresh direct workspace observations; a journal, receipt, or proposal status alone is not evidence.

Keep operation identities in their own namespaces: a Mission's `applyMission.operationId` is copied from and compared only to the Proposal's `operationId`; the acceptance `operationId` identifies the execution attempt and must match both `aiExecutions.operationId` and the action's `attemptId`.

**Why:** The prepared-candidate correlation and execution identity are distinct. Comparing a Mission or acceptance against the wrong identity rejects valid proofs; conflating them can also make recovery bind evidence from the wrong retry.

**How to apply:** Match Mission identity to Proposal identity; match acceptance to execution and attempt; then separately match the journal/event to Proposal correlation. Never use the stable Proposal identity as the attempt fence.

Never treat candidate/proposal-scoped observations as live-project facts. For an explicitly linked Apply Mission, only direct live-project before/after observations with subject `project:<projectId>`, their respective base/promoted tree revisions, and one fresh environment revision may materialize through the bound apply transition. D2 proof gates the Mission successor.

**Why:** Candidate verification, Gate-C acceptance, and filesystem promotion are separate from a durable live-world claim. Candidate-scoped hashes must not become live facts, and an accepted apply cannot satisfy Mission D2 without direct, revision-bound observations.

**How to apply:** Require the active-plan binding, accepted execution attempt/effect bundle, materialized transition, before/after tree hashes, and fresh environment binding. D2 failure blocks the linked successor and requires replan, but never revokes independent Gate-C acceptance or repeats filesystem promotion.

The read-only Mission handoff must reconstruct D2 from the durable Goal acceptance bound to the current attempt and transition, then display the successor's actual durable status. A materialized transition or dispatched report is not completion. Show a stale plan as blocked rather than silently omitting the handoff, and show only metadata—not the tree-hash values—of direct project observations.

**Why:** An earlier attempt or an accepted-but-stale plan can otherwise look proven after reload; treating dispatch as completion would overstate the outcome, while exposing observation values would leak project state.

**How to apply:** Keep active-plan and ownership checks in the read path; bind acceptance, execution attempt, transition, effect, and fresh before/after project observations before showing PROVEN. Continue reading nonterminal successor states so queued work eventually updates, and keep external delivery separate.

When recording the parent World State revision for an Apply Changes transition, exclude the active apply Episode; finalization must compare against that same parent projection.

**Why:** The live before/after observations are retained before the transition is created. Including them in the parent revision and excluding them during finalization makes a valid transition look like parent drift and leaves it retrying.

**How to apply:** Capture the parent with `getProjectWorldState` excluding the transition Episode, then preserve the matching exclusion during materialization. Keep those direct observations linked to the transition itself.

Canonical Apply acceptance is a separate artifact derived from the durable `ACTION_REQUESTED`/`ACTION_COMMITTED` events, an `OBSERVED` effect bundle, and the exact attempt-bound before/after observations. A lost response may replay success only when the request exactly matches the persisted applied changes, the `APPLIED` journal row is bound to the proposal correlation and current execution attempt, and duplicate finalization revalidates the same Canonical Proof. Replay must not repeat promotion, create a second acceptance or transition, or redispatch Goal work. A proposal ID never substitutes for required evidence.

**Why:** The Apply effect proves that the approved candidate was promoted; it does not prove live project state or Mission D2. A lost HTTP response can trigger an exact retry, but proposal status and journal rows are bookkeeping, not proof; trusting either alone can turn a retry into false success or repeat a side effect.

**How to apply:** Reconstruct and compare the artifact from durable rows during acceptance and every Canonical Proof load. For response replay, match the request and applied change set, bind journal correlation separately from execution-attempt identity, reload the prior acceptance, and use duplicate finalization. Keep D2 on its separate path through direct live-project observations and the transition bound to the active Mission plan.

Before materializing or recovering an Apply Changes World Transition, re-establish the persisted project root and hash its current tree against the promoted candidate. Fresh observation flags do not prove that the workspace stayed unchanged after those observations.

**Why:** A later workspace edit can coexist with an accepted effect bundle; trusting retained observations alone could materialize unrelated bytes as part of the approved change.

**How to apply:** Recheck the live candidate tree on every finalization attempt before the World State transaction. Retry transient database transaction failures while preserving acceptance/effect evidence and rolling back facts; keep binding, attempt, Episode, observation, and live-tree mismatches fail-closed.

Serialize Apply proof replay and World Transition materialization on the current Execution row before acquiring the effect bundle. Keep proof replay's Execution→Acceptance→Proposal→Episode→Bundle order; materialization takes Execution before Bundle, then may update Transition and Episode.

**Why:** A controlled PostgreSQL overlap reproduced `40P01` when materialization held Bundle and waited to update Episode while proof replay held Episode and waited for Bundle. This establishes a possible deadlock under that test schedule, not an observed production incident.

**How to apply:** When changing either path's row locks, keep materialization's current-attempt Execution lock ahead of Bundle and retain transition ownership and canonical proof checks. Verify with an isolated PostgreSQL overlap test.

An incomplete historical Apply Mission binding is not repairable from Goal text or request payload. Reject it before changing Proposal lifecycle or materializing a candidate; preserve the old Mission, cancel it if active, and recover by preparing a fresh Proposal and creating a new Apply Mission.

**Why:** Missing revision, base-tree, operation, or candidate identity cannot prove which prepared Proposal the old Mission authorized. Backfilling from mutable Goal content could bind proof to a different candidate, while mutating lifecycle before rejection can leave a delivery stranded in recovery.

**How to apply:** Audit read-only. Reuse a historical binding only when its exact durable Proposal identity remains complete and matches; otherwise keep D2 fail-closed and use the fresh Proposal/Mission path.

Creating a candidate-bound Apply Mission and applying its candidate are two separate user actions. Mission creation leaves the exact `apply-changes` Goal waiting; the UI may expose Apply only after the server projects one exact ready binding, and the existing apply handler must revalidate it before promotion.

**Why:** Candidate approval and Mission creation do not prove or authorize a completed apply. Combining them would hide the transition between review and filesystem effect; treating a readiness projection as authority could apply a stale or mismatched candidate.

**How to apply:** Keep Apply Mission creation non-mutating. Surface the separate apply action only when the persisted proposal, candidate, Mission, and waiting Goal match; submit through the existing guarded apply path, which remains authoritative. Return D2 transition and Goal-wake status separately from file-apply success; clients must not infer Mission completion from HTTP 2xx.
