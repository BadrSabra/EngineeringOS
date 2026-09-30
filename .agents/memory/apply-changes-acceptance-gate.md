---
name: Apply-changes acceptance gate
description: Proposal lifecycle release follows attempt-scoped effect acceptance; crash recovery must remain fail-closed.
---

Keep a proposal's Git-committable lifecycle blocked until the same execution attempt has a durable acceptance bound to an `OBSERVED` effect bundle. A source change can be physically present and its proposal status can say `applied` while lifecycle remains blocked; neither is proof that acceptance succeeded.

**Why:** Filesystem promotion, the apply journal/proposal update, and acceptance finalization cannot share one atomic transaction. A crash can leave promoted bytes without accepted effect. Git commit eligibility uses proposal lifecycle, so releasing it early could permit a commit after missing or failed proof.

**How to apply:** Release lifecycle only after effect acceptance is durably accepted. If the route crashes or the lifecycle projection update fails, retain the blocked state and return or preserve a non-success result. Recovery must use attempt-bound acceptance plus fresh direct workspace observations; a journal, receipt, or proposal status alone is not evidence.

Keep operation identities in their own namespaces: the proposal `operationId` is stable correlation for its journal and apply event, while the acceptance `operationId` identifies the execution attempt and must match both `aiExecutions.operationId` and the action's `attemptId`.

**Why:** Comparing acceptance directly to the proposal correlation ID rejects valid proofs; conflating the two can also make recovery bind evidence from the wrong retry.

**How to apply:** Match acceptance to execution and attempt, then separately match the journal/event to proposal correlation. Never use the stable proposal ID as the attempt fence.

Never treat candidate/proposal-scoped observations as live-project facts. For an explicitly linked Apply Mission, only direct live-project before/after observations with subject `project:<projectId>`, their respective base/promoted tree revisions, and one fresh environment revision may materialize through the bound apply transition. D2 proof gates the Mission successor.

**Why:** Candidate verification, Gate-C acceptance, and filesystem promotion are separate from a durable live-world claim. Candidate-scoped hashes must not become live facts, and an accepted apply cannot satisfy Mission D2 without direct, revision-bound observations.

**How to apply:** Require the active-plan binding, accepted execution attempt/effect bundle, materialized transition, before/after tree hashes, and fresh environment binding. D2 failure blocks the linked successor and requires replan, but never revokes independent Gate-C acceptance or repeats filesystem promotion.

When recording the parent World State revision for an Apply Changes transition, exclude the active apply Episode; finalization must compare against that same parent projection.

**Why:** The live before/after observations are retained before the transition is created. Including them in the parent revision and excluding them during finalization makes a valid transition look like parent drift and leaves it retrying.

**How to apply:** Capture the parent with `getProjectWorldState` excluding the transition Episode, then preserve the matching exclusion during materialization. Keep those direct observations linked to the transition itself.
