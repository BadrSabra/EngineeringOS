---
name: Embedded objective evidence
description: Evidence closure behavior for targeted embedded-AI project queries
---

`PROJECT_QUERY_EMBEDDED-AI` and `PROJECT_QUERY_GAP-ANALYSIS` share the same required-claim machinery, but a successful source manifest is not itself accepted evidence. The embedded-AI path must either materialize claim windows from retained bodies or produce provider citations that satisfy the behavioral evidence validator; otherwise complete reads can still end in `acceptedEvidenceCount=0` and a blocked objective. Enforce this accepted-evidence requirement only for `PROJECT_QUERY_*`; production-reachability objectives retain their separate edge/claim closure semantics.

**Why:** A live embedded-AI run retained every required source and every claim symbol was present in those bodies, yet the provider response was gated because deterministic materialization was scoped only to gap analysis. The durable trace did not retain the raw synthesis text or citation reasons, so postmortem evidence can prove the branch mismatch and aggregate rejection, but not the provider's exact missing citation/content detail.

**How to apply:** When investigating a targeted project-query acceptance failure, compare objective type before inspecting operation identity. Check retained bodies, `materializeObjectiveClaimEvidence`, `validateBehaviorEvidence`, and `closeObjectiveClaimsFromEvidence` together; treat `evidenceCount > 0` with `acceptedEvidenceCount=0` as citation/grounding rejection, not a read or Dashboard failure. Regression fixtures that inject retained bodies must also model completed source-read telemetry, or the independent telemetry gate will correctly reject the fixture. Do not apply this stricter closure rule to production-reachability claims.

An early incomplete PROJECT_QUERY path may emit the localized blocked response without a `forensic_status` step. Correlation identity must therefore be checked at the chat-to-tool-loop boundary, while claim closure and incomplete verdicts are checked in the final evidence and decision traces.

**Why:** The Arabic embedded-AI no-action journey terminates before the forensic status projection, but it still must preserve the server-owned operation and revision envelope and expose the missing-claim diagnostics.

**How to apply:** For no-action embedded-AI fixtures, assert the unchanged analysis correlation received by the real tool loop; assert zero accepted evidence, missing claims, and a non-verified objective outcome instead of requiring a forensic status record.