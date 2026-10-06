---
name: Evidence scheduler contract
description: Required source paths must be satisfied by complete or targeted reads before evidence-backed synthesis can be accepted.
---

The evidence loop should derive one ordered missing-path queue from both objective-level required paths and claim-level required paths. A truncated or failed read does not satisfy a path, and duplicate or cached replay only counts when it adds a new evidence window. When progress stalls, force the next missing path rather than repeatedly forcing the original first file.

**Why:** Provider turns can succeed while analysis remains empty if the model is allowed to synthesize after reading only one source or can reset the force latch with duplicate reads.

**How to apply:** Keep the scheduler server-owned, preserve targeted range reads as valid evidence, and keep terminal checkpoint evidence refs/verdicts derived from the same accepted reads. A successful prefetch must not suppress the transition to the next missing required path; prefetch satisfies evidence acquisition, not the complete objective manifest. After prefetch or each successful forced read, re-arm the gate for the next missing path; clear it only when the manifest is complete.

Provider fallback must continue from the same evidence cursor and execution budget. If a provider fails after tool progress, the server should emit a bounded incomplete-evidence report (with a resumable cursor) rather than restart the loop from iteration zero and surface only a generic provider error.

**Why:** In a live project question, a truncated first prefetch left the first path outstanding; the model spent the loop retrying blocked scope expansions, then provider fallback arrived after the shared budget was exhausted. The durable checkpoint was safe, but the user lost the actionable partial result.

**How to apply:** Preserve tool messages, read-status state, forced target, and ledger across provider changes; reserve bounded fallback capacity; map provider failure plus retained/incomplete evidence to the server-owned incomplete contract.

For one source path with multiple server-owned locator windows, `READ_TARGETED` means that at least one useful window exists, not that the path's objective evidence is complete. Synthesis and claim closure must wait until each required window is retained, and each novel bounded range must count as evidence progress even when the canonical path was already read.

**Why:** Strongest-status merging correctly promotes a targeted read over an earlier truncated read, but a path-only gate then mistakes the remaining windows for completed evidence; path-only progress accounting can also force a false no-progress terminal.

**How to apply:** Track objective window coverage separately from the strongest path status. When a pending locator window exists, dispatch its bounded range even if the path is now `READ_TARGETED`; reset progress only for a genuinely new range, never an exact replay.