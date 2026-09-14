---
name: Pre-loop provider failure recovery
description: Provider fallback can fail before the tool loop starts, replaying FEG prefetch and bypassing in-loop evidence recovery.
---

When every provider attempt fails before the first successful model response, the agent may repeat the eager first-evidence read for each attempt and terminalize before `executeToolLoop` can run its server-owned evidence recovery.

**Why:** A targeted project-query session showed repeated truncated FEG reads, no `model_call`, and an incomplete acceptance even though a fresh retry completed the same bounded evidence manifest.

**How to apply:** Keep prefetch and read-status state request-scoped across provider attempts, classify the seam as pre-loop provider failure, and add a bounded top-level handoff/test without claiming recovery ran when it did not.