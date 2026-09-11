---
name: Objective evidence range ownership
description: Behavioral objective reads must retain the server-computed claim window rather than an arbitrary provider-selected line range.
---

For an objective-scoped `read_file_range`, the server owns the effective line window whenever retained source content can resolve the claim's evidence needles. Provider-selected ranges are context hints only and must not be accepted as behavioral evidence when they miss the claim location.

**Why:** A provider can correctly choose the required file but request its first 200 lines, producing accepted-looking source evidence that contains imports or symbols while omitting the implementation that proves the claim.

**How to apply:** Compute and enforce the objective needle window before read caching and dispatch; keep a regression test where the provider requests `1..200` but the claim is later in the file.