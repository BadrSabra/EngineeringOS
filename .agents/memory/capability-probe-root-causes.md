---
name: Capability Probe root causes
description: Durable failure modes in the two-file C1–C7 probe across evidence closure, diagnostics, and terminal persistence.
---

The Capability Probe has three distinct states that must never be conflated: source bodies retained, claim-specific evidence accepted, and final claims closed. A run can have complete named-file reads while accepted evidence remains zero and the result is still `CLAIM_UNCLOSED`, not `NO_EVIDENCE_FOUND` or `NO_VERIFIED_FINDING`.

**Why:** A live failed execution showed complete coverage for both required files, zero accepted evidence, a generic `NO_EVIDENCE_FOUND` terminal marker, and a later `CLAIM_UNCLOSED` diagnostic. Deriving terminal metadata from different intermediate trace snapshots produced inconsistent public state.

**How to apply:** Compute one server-owned terminal summary after all capability-specific diagnostics are appended, persist that summary transactionally with the assistant outcome and checkpoint, and make every SSE/history/reconnect projection consume it.

Capability-specific citation recovery must not manufacture support from generic executable lines. A fallback excerpt is evidence only when the model or verifier selected the exact claim/source relationship; otherwise recovery can launder an unsupported C1–C7 claim into an apparently valid report.

**Why:** The current micro-probe fallback can append the first executable-looking line from a requested file after citation validation fails, which is unrelated to claim-specific proof.

**How to apply:** Make candidate evidence IDs and exact source paths mandatory, validate every claim against its selected candidate, and treat candidate discovery as deterministic over the full retained body rather than a first-match window.

When a Capability Probe ends with `CLAIM_UNCLOSED` or rejected capability evidence, public terminal telemetry must be non-resumable (`retryable: false`, `recoveryState: INCOMPLETE`) because the capability resume endpoint rejects that checkpoint.

**Why:** Advertising `recoveryState: REQUIRED` while rejecting the same execution at resume exposed contradictory operator state and suggested a recovery path that cannot close the missing claims.

**How to apply:** Let the server-owned terminal classifier recognize capability-specific claim-closure diagnostics before generic forensic recovery failure; preserve the incomplete report and checkpoint while directing operators to start a new run.

The complete-body predicate must be existential over the declared manifest, not an exact map-size comparison. Extra internal reads are scope telemetry to reject or filter, but they must not make two complete required bodies appear incomplete.

**Why:** A failed run retained the two declared bodies plus internal route/orchestrator reads; the exact-size check converted that valid source retention into `CAPABILITY_PROBE_RECOVERY_SKIPPED_INCOMPLETE`.

**How to apply:** Validate every required manifest path independently, enforce the capability probe's two-file scope at routing/prefetch time, and omit generic forensic terminal markers when the loop is cancelled.

Capability Probe reconnects are governed by an explicit persisted contract containing the required source manifest, C1–C7 claim IDs, and output contract; the generic `BEHAVIOR_QUERY` task type is not resumable by itself.

**Why:** Short retry messages are ordinary chat when classified in isolation, and making all behavior questions resumable would allow unrelated questions to revive an older probe.

**How to apply:** Persist and restore the probe contract in the execution request, resume contract, session state, and checkpoint; only that marker may opt a behavior query into continuation.