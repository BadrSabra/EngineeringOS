---
name: Project-query target binding
description: Ordinary project and architecture questions need target-aware evidence and semantic acceptance.
---

A project query that names a subsystem or architectural concern must bind the read plan and final answer to that target. A successful provider response, completed execution, non-empty citation list, or even completed reads is not enough when accepted evidence is zero or the diagnostic says the analysis is incomplete.

**Why:** Requests about the embedded AI layer were routed as generic project queries. One run browsed scanner files and another read a few orchestrator files, but both accepted generic/off-target answers; the latter explicitly recorded `ANALYSIS_INCOMPLETE/NO_EVIDENCE_REACHED` and `acceptedEvidenceCount=0`.

**How to apply:** Preserve the named target in the server-owned query contract, constrain initial reads to matching subsystem paths, and run a target/answer alignment gate before terminal acceptance. Keep ordinary architecture questions read-only, but still evidence-bound and semantically checked.