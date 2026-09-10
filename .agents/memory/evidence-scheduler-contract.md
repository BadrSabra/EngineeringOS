---
name: Evidence scheduler contract
description: Required source paths must be satisfied by complete or targeted reads before evidence-backed synthesis can be accepted.
---

The evidence loop should derive one ordered missing-path queue from both objective-level required paths and claim-level required paths. A truncated or failed read does not satisfy a path, and duplicate or cached replay only counts when it adds a new evidence window. When progress stalls, force the next missing path rather than repeatedly forcing the original first file.

**Why:** Provider turns can succeed while analysis remains empty if the model is allowed to synthesize after reading only one source or can reset the force latch with duplicate reads.

**How to apply:** Keep the scheduler server-owned, preserve targeted range reads as valid evidence, and keep terminal checkpoint evidence refs/verdicts derived from the same accepted reads. A successful prefetch must not suppress the transition to the next missing required path; prefetch satisfies evidence acquisition, not the complete objective manifest.