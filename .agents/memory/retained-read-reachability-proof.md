---
name: Retained-read reachability proof
description: How production reachability proofs flow from retained source reads into final-answer validation.
---

The final-answer proof validator must accept a syntax-derived direct invocation from a retained production read as positive reachability proof, not only externally supplied runtime trace metadata. Keep the two sources distinct so transport-only trace links cannot masquerade as application proof.

**Why:** Single-file forensic runs can establish a real caller-to-target edge from their mandatory retained source read while carrying no application-level trace link. Treating only external traces as positive proof causes a valid objective gate result to be downgraded later by the final-answer gate.

**How to apply:** When changing reachability validation, pass retained-read-derived proof into the positive-proof decision, but do not count transport/infrastructure links or import-only relations. Preserve the objective completion gate as the authority for whether all declared edges and claims are closed. Proof-basis telemetry must be deduplicated and scoped to those required, closed objective edges; unrelated runtime links must not inflate its counts.

For objective contracts, declare only caller-bound direct-invocation edges that the retained production source can actually expose; symbol names co-occurring in separate declarations are not execution proof.

**Why:** A semantic answer can contain every expected symbol while still lacking evidence that the production orchestrator invokes those symbols in its execution path.

**How to apply:** Keep fixture source bodies shaped like the production caller when testing closure, and expect missing caller-bound edges to remain incomplete in every terminal projection.

Expose syntax-derived closure as `SOURCE_AST` and execution-bound observation as `RUNTIME_OBSERVED`; use `BOTH` only when the same required edge has both forms of evidence. Keep behavioral-claim counts separate from structural/runtime edge counts.

**Why:** A combined accepted-requirement count can be valid for the gate while misleading operators into reading source structure as runtime observation or edges as behavioral claims. Historical records predate proof-basis metadata.

**How to apply:** New live and persisted projections should carry the explicit basis and separate counts without changing durable acceptance. For legacy records, label the combined count as legacy accepted requirements and render missing basis/counts as unavailable, never inferred zero.