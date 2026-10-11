---
name: Benchmark provider and scope isolation
description: Keep exact-model live attempts isolated and approved multi-file Build handoffs executable without broadening scope.
---

Live benchmark model pinning must constrain provider-owned fallback at the actual tool-loop call boundary, not only during health preflight. When a Repair Plan is an explicitly approved Build handoff, a single-file forensic read-only filter must not replace its write-capable tool manifest; the approved path manifest and dispatcher authorization remain the mutation boundary.

**Why:** A health probe can appear pinned while later tool-loop calls silently use a different free model, and forensic read-only narrowing can leave an approved repair unable to stage any change.

**How to apply:** Trace the model cap through the strategy call used by every tool-loop request. Keep approved paths, lifecycle binding, validation, and pending-change semantics unchanged; add a multi-file mocked handoff test and assert all pending edits remain inside the approved paths.
