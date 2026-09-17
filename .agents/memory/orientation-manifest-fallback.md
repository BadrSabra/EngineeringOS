---
name: Orientation manifest fallback
description: Project-orientation planner fallback behavior and its evidence/acceptance boundary
---

For project-orientation queries, a planner timeout can produce a fallback manifest with empty semantic roles while still having a usable primary-flow path. That manifest must not be persisted as immutable execution scope, because later provider retries hydrate it as a valid override and permanently prevent role coverage from recovering.

**Why:** A complete source read is not enough for orientation acceptance; purpose, components, primary flow, and uncertainty must each have server-owned role coverage. Persisting an incomplete fallback caused a full five-file read to end with zero accepted claims and an incomplete verdict.

**How to apply:** Keep planner fallback status and diagnostics durable. Before calling the orientation-manifest persistence boundary, require every role to have a bounded valid path; otherwise use a typed bounded planning-incomplete outcome or a deterministic role-discovery retry without freezing the partial manifest.