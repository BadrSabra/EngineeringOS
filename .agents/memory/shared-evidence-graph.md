---
name: Shared evidence graph
description: Canonical metadata graph joins retained reads, symbols, claims, sub-queries, and verdicts
---

Use one metadata-only graph for decomposed evidence. Deduplicate read windows by normalized path and line range, then connect FILE → SYMBOL → CLAIM → SUB_QUERY → VERDICT. Source bodies stay in the durable evidence snapshot/read store; graph nodes carry only safe references and provenance.

**Why:** Separate per-sub-query evidence projections duplicate reads, hide shared dependencies, and make contradictions and reconnect state harder to explain.

**How to apply:** Build the graph from server-owned retained reads, objective claims/claim closure, semantic trace symbols, sub-query receipts, and contradiction state. Persist the bounded graph metadata with the safe execution trace; never use provider prose or graph existence alone as proof.