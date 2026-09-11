---
name: Objective evidence range ownership
description: Behavioral objective reads must retain the server-computed claim window rather than an arbitrary provider-selected line range.
---

For an objective-scoped `read_file_range`, the server owns the effective line window whenever retained source content can resolve the claim's evidence needles. Provider-selected ranges are context hints only and must not be accepted as behavioral evidence when they miss the claim location. If no bounded cluster contains every required needle, a fixed head-window fallback is not evidence and must not be dispatched as if it were a claim read.

**Why:** A provider can correctly choose the required file but request its first 200 lines, producing accepted-looking source evidence that contains imports or symbols while omitting the implementation that proves the claim. The same failure can be reintroduced by server recovery when the locator returns no valid cluster but dispatch still substitutes `1..200`.

**How to apply:** Compute and enforce the objective needle window before read caching and dispatch, including server-forced recovery reads when the provider returns no usable evidence action; keep regressions for provider-selected ranges, forced `1..200` ranges, and the no-valid-cluster case. When a path has multiple generic needles, select the strongest bounded cluster containing all of them rather than independently selecting distant matches; if none exists, remain incomplete or use a separately verified multi-window strategy rather than silently reading the file head.