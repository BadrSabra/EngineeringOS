---
name: Checkpoint sequence coherence
description: Durable AI execution checkpoints may carry two independently persisted sequence indicators.
---

When writing the first checkpoint of a resumed execution, choose a sequence greater than both the sequence embedded in the checkpoint JSON and the durable checkpoint-version column.

**Why:** Finalization and recovery paths can advance the database version without advancing the embedded JSON sequence. Using only the JSON value causes the monotonic update fence to reject every resume, producing an endless recovery loop.

**How to apply:** Treat the database version as the authoritative lower bound for monotonic writes, while retaining the embedded sequence for resume context and diagnostics.