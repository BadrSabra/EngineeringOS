---
name: Durable acceptance provisional messages
description: Durable assistant rows remain non-terminal until the server-owned execution finalizer commits the authoritative outcome.
---

Durable assistant messages must be created as provisional records with no terminal outcome or final response content; streaming may expose a preview, but only the acceptance finalizer promotes the row to its terminal content and outcome.

**Why:** A durable row that starts as SUCCEEDED can survive a later execution or evidence failure and make reload/history report a false success.

**How to apply:** Keep ordinary non-execution chat unchanged, and pass the final response content into the same transaction that writes acceptance, checkpoint, execution state, and message outcome.