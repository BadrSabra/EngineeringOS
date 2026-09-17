---
name: Recovery coordinator boundary
description: Automatic recovery currently targets durable AI task executions; conversational recovery needs a separate request/evidence adapter.
---

The recovery coordinator may automatically retry or resume only durable task executions whose server-owned acceptance authorizes the action and whose task, project, revision, and budget checks still pass. General chat and project-query recovery must use a separate adapter that preserves the original request envelope, evidence scope, operation identity, revision, and cancellation semantics.

**Why:** Task lifecycle execution already owns provider invocation, retry identity, leases, and terminal acceptance. Reusing it for conversational turns would risk losing session/evidence bindings or treating a user-facing retry as a task retry.

**How to apply:** Extend the coordinator for task-linked executions without broadening its query to ordinary chat. Add chat/project-query recovery only through a dedicated server-owned execution path with the same acceptance and reconnect guarantees.