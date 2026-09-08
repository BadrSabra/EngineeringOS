---
name: Durable acceptance provisional messages
description: Durable assistant rows remain non-terminal until the server-owned execution finalizer commits the authoritative outcome.
---

Durable assistant messages must be created as provisional records with no terminal outcome or final response content; streaming may expose a preview, but only the acceptance finalizer promotes the row to its terminal content and outcome. A resumed attempt must not silently reuse an assistant row already referenced by an earlier acceptance; each attempt needs an independently finalizable message identity.

**Why:** A durable row that starts as SUCCEEDED can survive a later execution or evidence failure and make reload/history report a false success. Reusing the same row across attempts instead leaves the latest acceptance pointing at stale content and trace, making provider, cancellation, and evidence state disagree.

**How to apply:** Keep ordinary non-execution chat unchanged, and pass the final response content into the same transaction that writes acceptance, checkpoint, execution state, and message outcome. When rotating an attempt, exclude assistant rows already linked to a prior acceptance or carry an explicit attempt identity so the new terminal write cannot fall back to an old row.