---
name: Project-query target binding
description: Ordinary project and architecture questions need target-aware evidence and semantic acceptance.
---

A project query that names a subsystem or architectural concern must bind the read plan and final answer to that target. A successful provider response, completed execution, or non-empty citation list is not enough to accept a semantically unrelated answer.

**Why:** A request about the embedded AI layer was routed as a generic project query, let the model browse scanner files, and then accepted a `checkPatternInFiles` explanation with `SUCCEEDED` and `ACCEPTED` state.

**How to apply:** Preserve the named target in the server-owned query contract, constrain initial reads to matching subsystem paths, and run a target/answer alignment gate before terminal acceptance. Keep ordinary architecture questions read-only, but still evidence-bound and semantically checked.