---
name: Project-query direct-stream acceptance
description: The direct streaming path must produce the same server-owned analysis evidence contract as the non-streaming path.
---

For proof-required `PROJECT_QUERY` turns, a complete source-read set is not enough. The direct-content streaming path must emit the canonical verification and decision trace, including accepted claims/evidence, so the API can materialize `AnalysisEvidenceCompletion` and the acceptance gate can evaluate the semantic answer.

**Why:** A live OpenRouter direct-stream run can finish with a report-shaped provider response and complete retained reads while omitting `decision_trace` and recording zero accepted claims. The durable acceptance gate correctly blocks it, but the user sees a misleading retained report rather than a precise claim-closure failure.

**How to apply:** Keep direct streaming and the non-streaming/native-stream paths on one finalization seam. Assert that every proof-required project query emits `evidence_integrity`, `verification`, and `decision_trace`, and that the emitted response is replaced with the server-owned incomplete form whenever accepted claims are absent.