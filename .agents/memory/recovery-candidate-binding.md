---
name: Recovery candidate binding
description: Durable identity and revision rules for selecting automatic AI recovery candidates.
---

Automatic recovery selection must bind the acceptance row to the execution's current attempt. A database updatedAt timestamp is not a workspace content revision; when the current root revision is unavailable, defer provenance validation to the recovery handler instead of comparing unlike values.

**Why:** Older acceptance rows can otherwise re-dispatch executions that already advanced, while comparing a content hash to projects.updatedAt permanently rejects valid recovery. Both failures create user-visible recovery loops without granting useful progress.

**How to apply:** Join on execution id and attempt for every recovery candidate query. Preserve the persisted source revision and let the authoritative resume path validate the live root/revision. Partial orientation manifests are valid resumable checkpoints when their shape and revision remain valid; empty role lists alone must not discard the proof contract.

Task-linked recovery binds its candidate to the current Task-lifecycle execution: `aiExecutions.correlationId` must equal a non-null `tasks.correlationId`. Before the first lifecycle claim, a Task may have no pointer or a mission-planning marker; the lifecycle replaces that marker with the execution correlation. Task-aware Chat can carry `linkedTaskId` independently, but its execution correlation is not the Task-lifecycle pointer. Resume preflight checks project, eligible status, retry count, and pointer before provider resolution/token rotation. The lifecycle validates supplied count/pointer before execution creation and repeats its captured count and nullable pointer in the final Task claim. Automatic and manual retries rotate the Task marker; stale-lease reconciliation preserves it when the existing execution may be resumed. Missing or mismatched pointers fail closed; they are not inferred from attempt ordering.

**Why:** Task retry counts can advance during stale-lease recovery without creating a new execution, while resumed execution attempts can exceed attempts on a later execution. Neither counter establishes which linked execution is current.

**How to apply:** Treat `tasks.correlationId` as the Task-lifecycle binding only after claim; rotate the marker when a new execution generation is intended and preserve it when resuming the existing execution. Do not treat every row with the same `linkedTaskId` as that execution. Keep acceptance/UI attempt selection separate from recovery-candidate identity. The preflight-to-token/Task-claim interval is still non-atomic: if changing claim order, test concurrent pointer replacement, provider entry, and any durable execution/episode residue when the Task claim loses.