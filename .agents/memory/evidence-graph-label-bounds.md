---
name: Evidence graph label bounds
description: Durable handling for oversized labels when materializing evidence graphs.
---

Evidence graph node labels are presentation fields and must be bounded before schema validation. Preserve the full semantic identity in the node id and retain source paths, line ranges, and read bodies separately; never truncate those evidence-bearing fields to satisfy the label limit.

**Why:** Capability-probe responses can contain long claim or sub-query text. Rejecting the whole graph on an oversized label turns otherwise valid evidence into a runtime failure.

**How to apply:** Apply the bound centrally in the graph materializer so all node kinds are covered, while leaving IDs, reads, edges, and source evidence unchanged.