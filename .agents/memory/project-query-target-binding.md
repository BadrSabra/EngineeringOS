---
name: Project-query target binding
description: Ordinary project and architecture questions need target-aware evidence and semantic acceptance.
---

A project query that names a subsystem or architectural concern must bind the read plan and final answer to that target. A successful provider response, completed execution, non-empty citation list, or even completed reads is not enough when accepted evidence is zero or the diagnostic says the analysis is incomplete.

**Why:** Requests about the embedded AI layer were routed as generic project queries. One run browsed scanner files and another read a few orchestrator files, but both accepted generic/off-target answers; the latter explicitly recorded `ANALYSIS_INCOMPLETE/NO_EVIDENCE_REACHED` and `acceptedEvidenceCount=0`.

**How to apply:** Preserve the named target in the server-owned query contract, constrain initial reads to matching subsystem paths, and run a target/answer alignment gate before terminal acceptance. Keep ordinary architecture questions read-only, but still evidence-bound and semantically checked.

Analysis-backed project queries need their existing acceptance adapter: retained source reads are inputs to claim validation, not substitute proof, while validation artifacts from delivery/build flows are not the only valid proof type. The route's `AnalysisEvidenceCompletion` is a projection of the terminal trace, not a second claim gate; it must not be made to recompute upstream objective closure. A failed proof-required finalization must also persist `evidenceRequired=true`; otherwise a `NOT_RECORDED` snapshot can appear complete and obscure the real missing-claim state.

**Why:** A real embedded-AI run retained three complete reads and three accepted evidence files but still had `acceptedClaimCount=0`, `completionGateResult=BLOCKED`, and `finalAnswerType=NO_ANSWER`. The state and acceptance validators correctly rejected that projection; the defect was upstream evidence-window/candidate binding, not missing database acceptance logic.

**How to apply:** Fix objective read-window ownership first and add a terminal regression that asserts the same candidate reaches `closeObjectiveClaimsFromEvidence` and `AnalysisEvidenceCompletion`. Only change the route projection if that test shows it drops already-closed claims; never add a parallel acceptance layer.