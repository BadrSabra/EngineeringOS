---
name: Benchmark provider and scope isolation
description: Keep exact-model live attempts isolated and approved multi-file Build handoffs executable without broadening scope.
---

Live benchmark model pinning must constrain provider-owned fallback at the actual tool-loop call boundary, not only during health preflight. A usable provider-health preflight is not evidence that a completion request succeeded; if execution stops before reads, tools, or quality evidence, classify it as provider-unavailable U, not agent quality. Persist only allowlisted provider failure categories, never raw provider details. Never compare a targeted/subset scorecard with a full-suite baseline; mark it not compared, preserve rollout blocking, and reserve compatibility/regression verdicts for complete-suite runs. When a Repair Plan is an explicitly approved Build handoff, a single-file forensic read-only filter must not replace its write-capable tool manifest; the approved path manifest and dispatcher authorization remain the mutation boundary.

**Why:** A health probe can appear pinned while later tool-loop calls silently use a different free model; preflight can also be usable immediately before a real completion fails, leaving no evidence to judge agent quality. Comparing a one-case diagnostic to a full baseline mislabels the baseline as incompatible. Forensic read-only narrowing can leave an approved repair unable to stage any change, while raw provider text may contain unsafe or sensitive diagnostic data.

**How to apply:** Trace the model cap through the strategy call used by every tool-loop request. Compare baselines only when the current complete suite and observation counts match; keep partial-run blockers intact. Keep approved paths, lifecycle binding, validation, and pending-change semantics unchanged; add a multi-file mocked handoff test and assert all pending edits remain inside the approved paths.
