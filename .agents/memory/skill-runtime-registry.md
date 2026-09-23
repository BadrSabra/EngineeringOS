---
name: Skill runtime registry enforcement
description: Skill-backed Mission recipes are bound to the active registry row and rechecked before every capability node.
---

Skill-backed recipe execution must resolve a project-owned registry row that is both promoted and active, and must match candidate identity, source revision, candidate tree hash, proof receipt, and shadow replay. The complete binding is persisted with the durable recipe operation.

**Why:** Operator revocation must take effect before the next node, and a resume must not silently switch to a different registry/proof identity.

**How to apply:** Keep legacy recipes without a skill binding unchanged. For skill-backed recipes, perform an uncached database check before starting and before each node, and reject checkpoint/binding mismatches fail closed.