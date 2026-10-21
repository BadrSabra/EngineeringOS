---
name: Delivery proof identity
description: Durable identity rules for delivery receipts and canonical proof acceptance.
---

External delivery receipts are not authoritative when they contain only a status. Before canonical proof can accept delivery, the server must bind execution ID, attempt, operation ID, source revision, candidate tree identity, and delivered tree hash to durable rows and the committed proposal when available. The canonical loader hydrates delivery identity from the durable execution recipe receipt, not a caller-supplied projection receipt. Non-delivery verification recipes may use the execution-bound receipt contract without requiring external tree hashes.

Keep delivery proposal identity separate from the generic proposal ID used by execution completion: the latter selects the pending-review path. When enriching a sparse recipe receipt, persist only its established identity fields; projection-only fields can make schema-validated replay ignore the stored receipt.

Keep source candidate identity on the canonical acceptance and its durable execution/acceptance rows. Apply replaces proposal validation evidence with post-promotion receipts whose nested evidence binds candidate, change-set, and promoted hashes; do not require source-only identity fields from that later projection.

**Why:** Provider or recipe success can be replayed or detached from the candidate that was actually validated, so a status-only receipt could incorrectly complete a Goal. Reusing the review proposal field also changes terminalization semantics, while receipt-shape drift can break idempotent recovery. Source acceptance and post-promotion validation are separate authorities and must be checked at their own durable boundaries.

**How to apply:** Persist the complete server-owned recipe receipt on the execution row using a distinct delivery-proposal binding; retain the `RecipeReceipt` schema while adding execution, attempt, operation, revision, candidate-tree, and delivered-tree identity. Validate source identity through the accepted execution and acceptance row; validate Apply through proposal hashes and nested public validation evidence. Hydrate legacy sparse receipts only through the server-owned Mission path, then call `loadCanonicalProof`; keep public dashboard status derived from its projection.