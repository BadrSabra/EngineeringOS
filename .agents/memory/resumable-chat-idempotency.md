---
name: Resumable chat idempotency
description: Resume attempts must preserve one user turn while allowing each assistant execution outcome to remain auditable.
---

Resuming an interrupted AI execution is an assistant-outcome continuation, not a new conversational user turn. User-message persistence must be keyed to the durable execution and remain idempotent across failure, EOF, and successful resume.

**Why:** A reconnect can pass through failure persistence before the next attempt; unconditionally inserting the prompt on both paths duplicates history and misrepresents the user's conversation.

**How to apply:** When adding or changing resume/failure paths, assert one user message per execution, stable session/operation/revision identity, and independently persisted assistant outcomes. Serialize terminal persistence on the durable execution row before checking/inserting the assistant outcome; a read-then-insert check alone is not safe across concurrent reconnects.