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

Live provider success does not imply probe acceptance: citation recovery and micro-probes can consume additional quota after the initial response. A valid acceptance run therefore needs a provider with enough bounded recovery budget and at least one configured fallback.

**Why:** The latest live run completed both declared source reads and recorded a successful Gemini attempt, but the malformed response produced zero accepted claims; Gemini then returned quota errors during recovery and Groq was unavailable because its key was not configured.

**How to apply:** Treat provider capacity/configuration as a precondition for live C1–C7 acceptance, and inspect the recovery attempts separately from the initial provider success before diagnosing the acceptance gate.

Capability-probe recovery must consume only the request's server-authorized, currently selectable provider candidates; it must never invent a provider fallback from a process-wide key.

**Why:** A primary provider may be valid while another provider is absent, unhealthy, circuit-open, or outside the request's credential scope. An implicit Groq fallback created misleading recovery failures and hid the real provider cascade.

**How to apply:** Build recovery candidates after credential, lifecycle, capability, and circuit checks; pass their keys explicitly, record each nested attempt with a safe unique attempt ID, and keep a single configured provider valid for isolated deterministic runs.

Claim-scoped recovery is a different acceptance shape from full-report recovery: when the server has isolated one missing claim, validate and render only that claim before merging it into the retained report.

**Why:** Requiring the full C1–C7 contract during a targeted correction rejected otherwise valid server-owned claim evidence before the merge path could run.

**How to apply:** Keep the final `PROVEN` gate complete and strict, but let targeted recovery close only its named claim; persist micro-probe progress separately so later timeouts do not erase diagnostic state.

Capability preflight must treat invalid tool arguments as a capability/model failure, not transport failure, and must test a bounded sequence of model candidates before declaring the provider unavailable.

**Why:** A live probe reached the provider but the first catalog model emitted invalid JSON tool arguments; a one-model preflight and unsafe-code projection turned that into `NETWORK_ERROR` before any source read.

**How to apply:** Preserve `INVALID_TOOL_CALL` through safe health telemetry, allow a bounded preflight model chain to advance on it, and keep this behavior scoped to preflight rather than changing post-evidence recovery semantics.

Capability preflight must validate both the required tool call and the final `ChatResponse` JSON envelope; recovery after complete reads may use a small same-provider model chain, but remains bounded by the execution ledger and recovery deadline.

**Why:** A candidate could return a successful HTTP response and a valid tool call, then emit malformed synthesis JSON; a single recovery candidate could then be rate-limited even though source evidence was already complete.

**How to apply:** Treat semantic tool or structured-output failures as candidate-local, record every attempted model, and only mark the provider usable after both contracts pass. Never turn retained evidence into a proven report without the server-owned claim gate.

The capability recovery path must remove every parent abort listener it installs, and fallback candidates must be model-aware rather than deduplicated only by provider.

**Why:** A live probe accumulated anonymous abort listeners across repeated micro-probes, producing `MaxListenersExceededWarning`; the same-provider recovery path also retried one Groq model repeatedly because non-OpenRouter recovery forces one model and provider fallback de-duplicates by provider.

**How to apply:** Use one named abort handler with symmetric cleanup in `awaitAbortableRecovery`, and represent recovery candidates as provider/model attempts (or use deterministic server-owned claim assembly) so a malformed or slow model cannot consume the whole evidence-recovery window.