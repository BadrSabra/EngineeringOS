---
name: Gap-analysis baseline independence
description: The gap-analysis symbol-only objective failure predates the embedded-AI evidence-range locator change.
---

The `PROJECT_QUERY_GAP-ANALYSIS` recovery failure was independent of the embedded-AI locator fix. Its symbol-only claims do not satisfy the embedded-AI behavioral-flow predicate, so an empty provider synthesis reached the objective gate without a deterministic gap response. Gap analysis now has an explicit retained-read synthesis exception; arbitrary symbol-only objectives remain fail-closed.

**Why:** Running the gap-analysis test at the locator-fix commit and its parent produces the same BLOCKED response; changing the embedded-AI evidence-range or acceptance contract would mix unrelated behavior.

**How to apply:** Keep the gap-analysis exception scoped to `PROJECT_QUERY_GAP-ANALYSIS`; do not generalize it to embedded-AI or arbitrary symbol-only objectives. Treat the analysis-wiring and ordinary Gemini-tool failures as a separate baseline class unless a later diff directly touches their paths.