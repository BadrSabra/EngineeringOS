---
name: Test-to-code links
description: How static test coverage is represented in the project graph.
---

Direct calls found in recognized test files are persisted as `uses` relationships with the `test-covers` subtype, retaining source and target paths plus call-site evidence.

**Why:** a new relation enum would add schema churn, while ordinary `uses` already represents a dependency and the subtype preserves the more precise meaning.

**How to apply:** rank these edges ahead of filename heuristics during retrieval, and never resolve their endpoints by symbol name alone when a path-qualified identity is available.