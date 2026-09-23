---
name: Delivery proof identity
description: Durable identity rules for delivery receipts and canonical proof acceptance.
---

External delivery receipts are not authoritative when they contain only a status. Before canonical proof can accept delivery, the server must bind execution ID, attempt, operation ID, source revision, candidate tree identity, and delivered tree hash to durable rows and the committed proposal when available. Non-delivery verification recipes may use the execution-bound receipt contract without requiring external tree hashes.

**Why:** Provider or recipe success can be replayed or detached from the candidate that was actually validated, so a status-only receipt could incorrectly complete a Goal.

**How to apply:** Hydrate sparse runner receipts inside the server-owned Mission transaction, then pass the complete identity to `loadCanonicalProof`; keep public dashboard status derived from its projection.