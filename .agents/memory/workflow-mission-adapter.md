---
name: Workflow Mission adapter
description: Durable rules for workflow phase acceptance and event-driven Mission waits
---

Workflow phases must finalize through the shared execution acceptance seam. Intermediate phases persist acceptance evidence on the linked Goal but only the final phase may transition the Goal or Mission to a terminal status. The workflow, workflow execution, and Goal binding must still be present in the same project when the projection runs.

**Why:** Provider success and workflow HTTP transitions are not authoritative completion, and older workflow definitions intentionally use empty phase step arrays as no-op boundaries.

**How to apply:** Pass a server-owned phase projection into complete/fail acceptance, validate the binding before writing the Goal projection, and keep empty phases executable as accepted no-ops. Event waits must use a versioned, directly targeted envelope and reject stale plan revisions; waking one converts it to the existing replan path rather than adding a second scheduler.

Recipe-backed Mission delivery must validate the server-owned recipe receipt before projecting a delivery Goal as completed, and persist a delivery receipt in the Goal acceptance contract. A recipe runner's status alone is not proof.

**Why:** A direct runner status update can make a Mission look completed while the acceptance projection has no durable delivery evidence.

**How to apply:** Parse the receipt with the shared RecipeReceiptSchema, require a completed receipt, then project `deliveryReceipt` and only afterward derive Goal/Mission terminal status.