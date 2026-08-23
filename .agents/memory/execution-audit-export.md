---
name: Execution audit exports
description: Portable execution audits must be assembled from owner-scoped durable state and allowlisted operational fields.
---

Audit downloads should project persisted execution, checkpoint, validation, and correlated event data rather than serialize live UI state. Keep provider secrets, raw model output, and private runtime paths out through explicit allowlists and path checks.

**Why:** Incident and compliance handoffs need records that remain available after reconnects without exposing sensitive provider or host details.

**How to apply:** Preserve the client’s durable execution pointer through terminal states and make the export endpoint owner-scoped; update the OpenAPI contract whenever the export shape changes.