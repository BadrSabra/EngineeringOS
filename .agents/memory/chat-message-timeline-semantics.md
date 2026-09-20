---
name: Chat message timeline semantics
description: Explains why persisted assistant message timestamps may precede durable execution completion.
---

Conversation message timestamps are not always terminal-event timestamps. The assistant row can be persisted with a request-owned logical time while the durable execution, provider usage, checkpoint, and acceptance complete later.

**Why:** A failed AI turn showed its assistant message timestamp before the execution row's completion time, which can make a chronological audit look impossible if message timestamps are treated as the source of truth.

**How to apply:** Order execution investigations by execution creation/start, provider usage, checkpoint/trace events, acceptance creation, and message linkage. Use message timestamps for conversation ordering only. Do not treat `updated_at` as the latest user turn: lease recovery and background reconciliation can update an older failed execution after a newer run has already succeeded.