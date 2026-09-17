---
name: Project orientation deterministic fallback
description: Server-owned recovery contract for complete orientation reads when provider synthesis is malformed or unavailable.
---

When project-orientation coverage is complete, a malformed or exhausted provider synthesis may be replaced by a bounded answer assembled only from the immutable role manifest and complete retained source bodies. The fallback must clear the provisional parse failure, preserve verified source paths, and emit an explicit diagnostic. If any role lacks a complete read, it must fail closed as ANALYSIS_INCOMPLETE.

**Why:** Provider formatting and transport failures should not discard a complete source inspection, but source coverage alone must never justify invented project claims.

**How to apply:** Keep this recovery separate from targeted PROJECT_QUERY claim acceptance; add new role or evidence semantics to the server-owned fallback contract and test both complete and missing-role paths.