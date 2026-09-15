---
name: Execution projection surfaces
description: Shared server-owned execution projection is the common read model for Chat, Tasks, Mission Control, and Flight Deck.
---

All operator-facing execution surfaces should render the server-owned projection when it is available, while retaining their existing local panels as compatibility fallback. Projection actions are displayable only when the acceptance snapshot authorizes them; Chat may execute retry/resume through the existing durable resume stream, while read-only history surfaces must not invent controls.

**Why:** The same execution can be viewed from several routes, and deriving progress or allowed actions independently causes contradictory status, evidence, and recovery guidance.

**How to apply:** Add new lifecycle fields to the projection first, then consume that contract in each surface. Keep reconnect, timeline, delivery, and task-specific controls on their existing paths until they can be migrated without changing their ownership boundaries.