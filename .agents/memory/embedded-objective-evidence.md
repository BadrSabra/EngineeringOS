---
name: Embedded objective evidence
description: Evidence closure behavior for targeted embedded-AI project queries
---

`PROJECT_QUERY_EMBEDDED-AI` and `PROJECT_QUERY_GAP-ANALYSIS` share the same required-claim machinery, but a successful source manifest is not itself accepted evidence. The embedded-AI path must either materialize claim windows from retained bodies or produce provider citations that satisfy the behavioral evidence validator; otherwise complete reads can still end in `acceptedEvidenceCount=0` and a blocked objective.

**Why:** A live embedded-AI run retained every required source and every claim symbol was present in those bodies, yet the provider response was gated because deterministic materialization was scoped only to gap analysis. The durable trace did not retain the raw synthesis text or citation reasons, so postmortem evidence can prove the branch mismatch and aggregate rejection, but not the provider's exact missing citation/content detail.

**How to apply:** When investigating a targeted project-query acceptance failure, compare objective type before inspecting operation identity. Check retained bodies, `materializeObjectiveClaimEvidence`, `validateBehaviorEvidence`, and `closeObjectiveClaimsFromEvidence` together; treat `evidenceCount > 0` with `acceptedEvidenceCount=0` as citation/grounding rejection, not a read or Dashboard failure. Regression fixtures that inject retained bodies must also model completed source-read telemetry, or the independent telemetry gate will correctly reject the fixture.