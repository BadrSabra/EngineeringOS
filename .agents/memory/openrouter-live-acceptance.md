---
name: OpenRouter live acceptance
description: Operational distinction between authenticated provider responses and accepted structured-review evidence.
---

OpenRouter catalog access and a successful completion are not sufficient for a live review pass. The campaign must separately prove structured-output acceptance and retained file evidence; free-model contract failures and agentic-harness restrictions stay incomplete rather than spending on paid models. The disposable review fixture must contain one intentional, bounded defect so a valid response has a concrete selected-file finding to cite; a clean fixture cannot prove evidence acceptance. A classified free rate/quota failure may make one explicit paid attempt, and the receipt must show both tiers even when the paid attempt terminates before a parsed response. Full-source runs can additionally expose malformed tool-call output and telemetry/evidence-count mismatches; those are non-success until the server-owned acceptance gate closes. Partial/truncated prefetch bodies may remain available for coverage diagnostics, but must never be promoted into complete evidence records or completed-read counts.

**Why:** Live free models can return useful text while failing the review JSON contract, and OpenRouter can gate individual free models even when the credential and catalog are healthy. Treating provider success as acceptance would create false proof. A clean review result is also semantically incompatible with a campaign that requires one selected-file finding. Larger source scopes increase the chance of finding mismatched read/evidence accounting that a small fixture does not exercise.

**How to apply:** Keep provider readiness, model fallback, contract parsing, evidence correlation, and final acceptance as separate gates in future live campaigns and release receipts. When reconciling a run, pass partial prefetch paths explicitly so the ledger excludes them while the UI can still report incomplete coverage.

The Code Agent benchmark's provider-health probe is cached once per executor and gates every case. A failed preflight can therefore produce a full set of U rows without executing those cases. The bounded candidate walk should continue after a candidate timeout, but only a valid capability response may unlock case execution. Once cases have started, repeated request timeouts can still open the provider circuit and yield U; shared cooldown-store unavailability alone does not prove provider calls are blocked.

**Why:** A live run produced 34 U rows from one shared probe sequence (empty response, then timeout), not 34 independent task attempts. A bounded timeout fallback let a later candidate pass the same probe; a subsequent full campaign still had genuine per-case failures and circuit-open U results.

**How to apply:** Before interpreting U totals or comparing quality, verify whether case tool calls actually started. A long first-row latency followed by near-zero rows indicates a shared preflight failure; distinguish it from later per-case timeouts and circuit-open skips. Keep all results isolated from the canonical baseline until the release gate passes.

Case-level deadlines remain authoritative when the agent resolves normally after its abort signal. Check the deadline after each awaited execution, validation, and oracle stage; send expired cases through the same unavailable (U) projection as rejected timeout calls instead of scoring a late BLOCKED result as F.

**Why:** OpenRouter agent loops may handle cancellation internally and return a normal BLOCKED chat result. Catch-only timeout handling then mistakes an expired case for a quality failure.

**How to apply:** Preserve bounded partial telemetry, skip remaining validation/oracle work after the deadline, and classify the result as U at every asynchronous boundary.

Every provider-unavailable or timed-out observation must retain the candidate hash, even though it contributes no quality evidence. Candidate identity and provider availability are separate facts.

**Why:** A live case timeout returned U but omitted the already-computed candidate hash on an executor error path, creating a separate scorecard blocker and weakening run attribution.

**How to apply:** Include candidate identity in health-preflight, exception, and deadline projections; test each early return independently.

A case deadline must race all awaited post-setup stages (handoff, chat, final validation, and oracle), not only abort the provider signal. Pass the deadline signal and an ownership check into chat; deferred file mutations must recheck cancellation after awaited path/source reads and before staging. Provider health and fixture setup retain their separate bounded lifecycles.

**Why:** A timer that only aborts can still leave the runner waiting on a chat promise that never settles. Returning U promptly is safe only when late provider/tool work cannot stage changes after the disposable candidate root is cleaned up.

**How to apply:** Test both a never-settling chat and a source read that completes after cancellation. Keep candidate identity on timeout U rows, and distinguish provider-level timeouts that occur before the case deadline from deadline expirations themselves.