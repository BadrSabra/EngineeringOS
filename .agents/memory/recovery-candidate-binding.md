---
name: Recovery candidate binding
description: Durable identity and revision rules for selecting automatic AI recovery candidates.
---

Automatic recovery selection must bind the acceptance row to the execution's current attempt. A database updatedAt timestamp is not a workspace content revision; when the current root revision is unavailable, defer provenance validation to the recovery handler instead of comparing unlike values.

**Why:** Older acceptance rows can otherwise re-dispatch executions that already advanced, while comparing a content hash to projects.updatedAt permanently rejects valid recovery. Both failures create user-visible recovery loops without granting useful progress.

**How to apply:** Join on execution id and attempt for every recovery candidate query. Preserve the persisted source revision and let the authoritative resume path validate the live root/revision. Partial orientation manifests are valid resumable checkpoints when their shape and revision remain valid; empty role lists alone must not discard the proof contract.