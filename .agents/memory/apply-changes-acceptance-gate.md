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
