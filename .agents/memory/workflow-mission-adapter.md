---
name: Workflow Mission adapter
description: Durable rules for workflow phase acceptance and event-driven Mission waits
---

Workflow phases finalize through the shared execution acceptance seam. Non-empty phases may project acceptance to a linked Goal only after substantive, revision-bound evidence is accepted; only the final phase may transition the Goal or Mission to a terminal status. Empty phases are durable no-op boundaries: they may complete with `proofRequired=false`, but must not create Canonical Proof or project Goal/Mission completion. Any Goal projection must validate that the workflow, execution, and Goal binding remain in the same project.

**Why:** Provider success and HTTP transitions are not authoritative completion. Older definitions intentionally have empty phase step arrays, while the generic operation gate requires evidence; treating a no-op as proof would weaken that gate.

**How to apply:** Keep empty phases out of the proof-bearing operation and Goal-projection path. For non-empty phases, pass a server-owned projection only alongside accepted evidence and validate its binding before writing. Event waits must use a versioned, directly targeted envelope and reject stale plan revisions; waking one converts it to the existing replan path rather than adding a second scheduler.

Recipe-backed Mission delivery must validate the server-owned recipe receipt before projecting a delivery Goal as completed, and persist a delivery receipt in the Goal acceptance contract. A recipe runner's status alone is not proof.

**Why:** A direct runner status update can make a Mission look completed while the acceptance projection has no durable delivery evidence.

**How to apply:** Parse the receipt with the shared RecipeReceiptSchema, require a completed receipt, then project `deliveryReceipt` and only afterward derive Goal/Mission terminal status.