---
name: Project orientation deterministic fallback
description: Server-owned recovery contract for complete orientation reads when provider synthesis is malformed or unavailable.
---

When project-orientation coverage is complete, a malformed or exhausted provider synthesis may be replaced by a bounded answer assembled only from the immutable role manifest and complete retained source bodies. The fallback must clear the provisional parse failure, preserve verified source paths, and emit an explicit diagnostic. If any role lacks a complete read, it must fail closed as ANALYSIS_INCOMPLETE.

**Why:** Provider formatting and transport failures should not discard a complete source inspection, but source coverage alone must never justify invented project claims.

**How to apply:** Keep this recovery separate from targeted PROJECT_QUERY claim acceptance; add new role or evidence semantics to the server-owned fallback contract and test both complete and missing-role paths.

Project-aware fallback sub-queries must reserve bounded slots for explicitly named source files before adding graph-derived entity or relationship hints. Graph labels and relationships can guide navigation, but must be labeled as non-evidence; complete retained source reads remain the only evidence boundary.

**Why:** A dense graph can crowd out the file the user explicitly named, and graph rows can be stale or heuristic even when they are project-scoped.

**How to apply:** Keep explicit paths ahead of graph hints in deterministic ordering, cap the total questions, and state the navigation-only boundary in the fallback response.