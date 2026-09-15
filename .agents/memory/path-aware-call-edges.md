---
name: Path-aware static call edges
description: The identity and persistence rule for AST-derived call relationships.
---

Static call relationships must carry the source and target project-relative paths in addition to symbol names. Persistence should resolve the path-qualified identity first and use name-only lookup only as a compatibility fallback for legacy edges.

**Why:** function names are routinely duplicated across modules; name-only resolution can silently attach a call edge to the wrong entity while still producing a valid-looking graph.

**How to apply:** any new static relationship extractor should emit endpoint paths, and any graph persistence path should preserve exact endpoint resolution before global name fallback.