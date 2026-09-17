---
name: Orientation manifest fallback
description: Project-orientation planner fallback behavior and its evidence/acceptance boundary
---

For project-orientation queries, a planner timeout can produce a fallback manifest with empty semantic roles while still having a usable primary-flow path. That manifest must not be persisted as immutable execution scope, because later provider retries hydrate it as a valid override and permanently prevent role coverage from recovering.

**Why:** A complete source read is not enough for orientation acceptance; purpose, components, primary flow, and uncertainty must each have server-owned role coverage. Persisting an incomplete fallback caused a full five-file read to end with zero accepted claims and an incomplete verdict.

**How to apply:** Keep planner fallback status and diagnostics durable. Before calling the orientation-manifest persistence boundary, require every role to have a bounded valid path; otherwise pass bounded role candidates/missing roles into the existing evidence scheduler for one deterministic discovery retry, or emit a typed planning-incomplete outcome without freezing the partial manifest. An incomplete manifest must not become an empty recovery path. If retained orientation reads exist but provider output is malformed, allow one server-owned no-tools synthesis attempt and record its parse/provider failure explicitly.

Legacy execution requests may still parse with partial orientation manifests for compatibility; enforce completeness when creating or persisting new manifests rather than rejecting old durable state at the parser boundary.