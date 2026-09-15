---
name: Hierarchical retrieval boundary
description: The ownership boundary between graph retrieval planning and source reads.
---

Hierarchical retrieval should use the persisted, project-scoped graph to produce bounded ranked source and test paths, but it should not read source bodies itself. Server-owned read tools remain responsible for bytes, truncation, revision checks, and acceptance evidence.

**Why:** combining graph planning with file reads duplicates existing tool contracts and makes provenance, oversized files, and evidence completeness harder to enforce consistently.

**How to apply:** extend the retrieval planner with graph, symbol, AST, and test signals while returning evidence references and revision identity; pass its paths to the existing server-owned read pipeline.