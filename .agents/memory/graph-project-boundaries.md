---
name: Graph project boundaries
description: Rules for isolating graph traversal and list responses by project
---

Graph traversal must validate both endpoint entities against the authorized project, not trust a relationship's denormalized project field alone. Legacy relationships with a null project ID may remain usable only when both endpoints are project-scoped.

**Why:** graph rows can be deliberately cross-linked or carry stale denormalized ownership metadata; filtering only the starting node or edge project can leak topology and evidence.

**How to apply:** pass the authorized project through traversal helpers, constrain every fetched entity and edge, and expose page/total/truncated metadata whenever a list is bounded.