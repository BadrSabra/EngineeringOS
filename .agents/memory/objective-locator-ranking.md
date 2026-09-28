---
name: Objective locator ranking
description: Bounded objective reads should select compact source evidence, not later quoted mentions of the same tokens.
---

Objective range selection is retrieval only; it must never alter the canonical objective or acceptance contract. When needles occur both in executable code and in later prose, favor the compact executable context that contains the complete locator set.

**Why:** A later diagnostic prompt repeated a call-shaped identifier and outranked the real execution site in a full production source body. The resulting synthesis excerpt contained the token but not the behavior the claim described.

**How to apply:** Keep locator regression fixtures source-faithful, include quoted/commented decoys, and verify that the retained window contains the co-located runtime evidence. Do not rewrite source or inject proof to make a test pass.