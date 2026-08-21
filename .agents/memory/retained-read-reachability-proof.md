---
name: Retained-read reachability proof
description: How production reachability proofs flow from retained source reads into final-answer validation.
---

The final-answer proof validator must accept a syntax-derived direct invocation from a retained production read as positive reachability proof, not only externally supplied runtime trace metadata. Keep the two sources distinct so transport-only trace links cannot masquerade as application proof.

**Why:** Single-file forensic runs can establish a real caller-to-target edge from their mandatory retained source read while carrying no application-level trace link. Treating only external traces as positive proof causes a valid objective gate result to be downgraded later by the final-answer gate.

**How to apply:** When changing reachability validation, pass retained-read-derived proof into the positive-proof decision, but do not count transport/infrastructure links or import-only relations. Preserve the objective completion gate as the authority for whether all declared edges and claims are closed.