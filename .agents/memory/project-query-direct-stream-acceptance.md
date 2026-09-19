---
name: Project-query direct-stream acceptance
description: The direct streaming path must produce the same server-owned analysis evidence contract as the non-streaming path.
---

For proof-required `PROJECT_QUERY` turns, a complete source-read set is not enough. The direct-content streaming path must emit the canonical verification and decision trace, including accepted claims/evidence, so the API can materialize `AnalysisEvidenceCompletion` and the acceptance gate can evaluate the semantic answer. A proof-complete targeted query must not return from the provider direct-content or retained-evidence branch before response binding and objective closure; this applies to every `PROJECT_QUERY_*` objective, not only embedded-AI.

**Why:** A live OpenRouter direct-stream run can finish with a report-shaped provider response and complete retained reads while omitting `decision_trace` and recording zero accepted claims. A separate gap-analysis run reached complete materialization and no-tools synthesis, then returned through a retained-evidence branch because its complete-objective override was restricted to embedded-AI; the response-binding and objective-closure stages never ran.

**How to apply:** Keep direct streaming, retained-evidence fallback, and the non-streaming/native-stream paths on one finalization seam. Assert that every proof-required project query emits `evidence_integrity`, `verification`, and `decision_trace`, and that the emitted response is replaced with the server-owned incomplete form whenever accepted claims are absent. If all required claims are materialized, let the canonical server-owned response/evidence projection reach the objective gate instead of re-deriving evidence from provider prose.

The direct-stream seam must also preserve the server-owned project-query response while applying generic required-claim and objective gates. A gate may inspect the override, but must not replace it with a generic blocked response before response binding and objective closure; otherwise the gate receives no claim text and reports every claim missing even when materialization is complete.

**Why:** A gap-analysis run materialized all three claims, but the direct-stream objective gate emitted the generic Arabic blocked response before the response-binding diagnostic. The final trace therefore recorded `responseUsesOverride=false`, zero closed claims, and an incomplete acceptance despite complete required paths.

**How to apply:** Add a direct-stream regression that asserts the response passed into the objective gate remains the server-owned override, and record the pre-gate candidate plus closure IDs when it does not. Keep unrelated incomplete reads from silently replacing a complete required project-query projection.