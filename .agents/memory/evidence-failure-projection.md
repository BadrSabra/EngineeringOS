---
name: Evidence failure projection
description: Durable rules for user-facing and terminal evidence status when an AI analysis fails.
---

Provider failures in evidence-required turns must project the observed evidence state, not assume that failure happened before all reads. Distinguish no source read, attempted but incomplete reads, and retained complete reads with incomplete coverage. Keep provider diagnostics out of user-facing messages and terminal evidence reasons.

**Why:** A provider can fail after useful source evidence has already been retained; claiming that no files were read hides progress and misleads resume behavior.

**How to apply:** Build the summary from the current trace plus retained complete evidence before persisting the assistant failure or terminal execution state. Preserve cancellation precedence and ordinary-chat wording.

Keep the sanitized primary failure cause separate from proof acceptance. A timeout or exhausted investigation budget may be surfaced as the reason the turn stopped, while the acceptance disposition remains `INCOMPLETE`; do not replace the cause with only `EXECUTION_ACCEPTANCE_INCOMPLETE` or expose raw provider error text.

**Why:** A development code-check session read complete sources but exhausted its 150-second deadline during provider retries. The durable forensic diagnostic recorded `TIMEOUT`, while the persisted assistant error exposed only missing acceptance evidence.

**How to apply:** For failed proof-required turns, correlate the durable diagnostic and request ledger with the acceptance row. Preserve the safe terminal cause and incomplete evidence status as separate fields in user-facing projection.

Telemetry coverage and persisted evidence snapshots are separate layers. A
snapshot must not silently drop reads because of a retention cap and then let
acceptance infer that the investigation had fewer or no usable sources.

**Why:** A broad review recorded 263 source reads and `256/257` coverage, while
the durable snapshot retained only 128 reads due to its storage limit. The user
received an incomplete result without a precise distinction between scope
coverage and body-retention capacity.

**How to apply:** Persist complete read metadata for the whole required scope,
track omitted bodies/paths explicitly, and make terminal classification use the
full evidence ledger rather than the retained-body count.

For a general PROJECT_QUERY that cannot be synthesized, a bounded source excerpt
may preserve useful context only when its retained status confirms a complete
full-file read. Keep that projection `ANALYSIS_INCOMPLETE`; excerpts do not close
claims or become acceptance evidence. Do not apply this to project orientation
or specialized targeted objectives.

**Why:** A user can still benefit from seeing the exact source that was read,
but a deterministic excerpt has no semantic claim closure and must not appear
to be a completed project answer.

**How to apply:** Require `READ_COMPLETE`/`READ_CACHED`, reject truncated or
unknown bodies, cap both displayed files and excerpt text, and keep the existing
objective acceptance path unchanged.

For a general project-query failure, choose source windows by exact normalized
question-term overlap and show their line ranges and matched terms. If no query
term appears in the retained bodies, fall back to recognizable source structure
and label it as structural context only. Keep selection explicitly bounded and
non-exhaustive.

**Why:** Deterministic relevance and line references make a failed answer useful
to inspect without disguising ranking as semantic analysis or proof.

**How to apply:** Keep the ranker lexical and server-side; never let excerpt
ranking alter claims, evidence closure, or terminal acceptance.