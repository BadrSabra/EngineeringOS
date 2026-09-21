---
name: Orientation acceptance boundary
description: Project orientation uses role coverage and a server-owned validator receipt, not targeted project-query analysis evidence.
---

Project orientation is a proof-backed read-only execution, but its acceptance contract is complete server-owned role coverage. It must not be forced through the targeted PROJECT_QUERY `analysisEvidence` gate; successful coverage still produces a bound `project-query-evidence.v1` receipt.

**Why:** Orientation has no inferred target objective, so applying the targeted evidence gate rejects complete, valid role reads even when the orientation coverage contract is satisfied.

**How to apply:** Keep orientation excluded from targeted project-query proof checks, require complete orientation coverage before terminalization, and derive objective validation only from that server-owned coverage result.

The orientation verdict must be derived from the same role-coverage closure at every finalization seam, including non-native and native streaming traces. The route acceptance boundary must refuse a successful terminal projection when complete coverage is paired with an explicitly incomplete decision trace.

**Why:** Orientation may not carry a structured target objective, so generic objective-gate telemetry can remain incomplete even after all server-owned role reads are complete; allowing that stale trace beside `PROVEN` creates public parity contradictions.

**How to apply:** Treat complete orientation coverage as `ANSWER_COMPLETE` evidence without requiring an inferred objective, and keep the acceptance projection incomplete if its persisted decision trace explicitly reports recovery or non-verification.

Acceptance must distinguish missing role coverage from missing source-selection telemetry. A durable role manifest plus complete revision-bound reads proves coverage; an absent optional trace should be reported as an observability gap, not silently reclassified as missing source evidence.

**Why:** A real orientation execution persisted all seven manifest paths and complete read bodies, but no source-selection record reached the terminal projection, so the acceptance layer produced `PARTIAL` without evidence loss.

**How to apply:** At investigation and finalization boundaries, compare manifest/read completeness independently from source-selection presence and emit separate diagnostics for coverage failure versus telemetry loss.

Orientation role coverage is not a behavioral claim, but a completed orientation must not project as generic verification with zero accepted evidence when the dashboard interprets that counter as incomplete verification.

**Why:** The orientation acceptance branch correctly accepted complete role coverage and retained reads, while the shared evidence trace still emitted `acceptedEvidenceCount=0` and `evidenceSelected=0`; the live dashboard then labeled verification as incomplete despite the durable `PROVEN` result.

**How to apply:** Keep orientation proof separate from targeted claim counts, but add an explicit orientation coverage projection (or an equivalent typed status) to every trace/UI verification surface instead of overloading behavioral counters.

The canonical role-coverage calculator is shared, but its callers must share one server-observed read-status precedence rule; a retained body alone must not silently upgrade a failed or truncated read.

**Why:** The normal orientation path overlays `READ_COMPLETE` for paths present in its content map, while provider-exhaustion fallback preserves an existing failed/truncated status. The same role manifest can therefore produce different coverage outcomes depending on the provider path.

**How to apply:** Resolve one final status map after reads, reuse the resulting source-selection record for acceptance and public projections, and only mark a path complete from a validated complete-read observation.

Provider-exhausted orientation fallback is a separate path from chat-agent finalization and can return a minimal answer before source-selection/evidence projections are emitted.

**Why:** The all-provider fallback can assemble a correct response from the durable role manifest and retained reads while bypassing the late `ChatResult` provenance assembly, leaving acceptance without the coverage record.

**How to apply:** Keep one ownership boundary for deterministic fallback provenance; do not add a second coverage calculator in acceptance or treat fallback prose as proof.