---
name: OpenRouter live acceptance
description: Operational distinction between authenticated provider responses and accepted structured-review evidence.
---

OpenRouter catalog access and a successful completion are not sufficient for a live review pass. The campaign must separately prove structured-output acceptance and retained file evidence; free-model contract failures and agentic-harness restrictions stay incomplete rather than spending on paid models. The disposable review fixture must contain one intentional, bounded defect so a valid response has a concrete selected-file finding to cite; a clean fixture cannot prove evidence acceptance. A classified free rate/quota failure may make one explicit paid attempt, and the receipt must show both tiers even when the paid attempt terminates before a parsed response. Full-source runs can additionally expose malformed tool-call output and telemetry/evidence-count mismatches; those are non-success until the server-owned acceptance gate closes. Partial/truncated prefetch bodies may remain available for coverage diagnostics, but must never be promoted into complete evidence records or completed-read counts.

**Why:** Live free models can return useful text while failing the review JSON contract, and OpenRouter can gate individual free models even when the credential and catalog are healthy. Treating provider success as acceptance would create false proof. A clean review result is also semantically incompatible with a campaign that requires one selected-file finding. Larger source scopes increase the chance of finding mismatched read/evidence accounting that a small fixture does not exercise.

**How to apply:** Keep provider readiness, model fallback, contract parsing, evidence correlation, and final acceptance as separate gates in future live campaigns and release receipts. When reconciling a run, pass partial prefetch paths explicitly so the ledger excludes them while the UI can still report incomplete coverage.

OpenRouter telemetry's `outputTextLength` measures only top-level `output_text`; a zero there does not mean `message.content` is empty. Some free endpoints return nonempty visible content that is malformed JSON, while others return an empty object or no message content. Reasoning metadata is separate and never substitutes for accepted structured output. Raising the code-review output budget from 2,048 to 4,096 tokens did not establish reliable acceptance.

**Why:** Live probes showed `contentLength` can be substantial while `outputTextLength` is zero; relying on the latter alone misclassifies malformed visible completions as reasoning-only output.

**How to apply:** Interpret `contentLength`, top-level `outputTextLength`, reasoning length, finish reason, and model identity separately. Keep malformed, empty, timed-out, and throttled cases incomplete; probe one candidate before spending the full corpus and stop when automatic fallback would change the model under test.

OpenRouter `structured_outputs` metadata identifies endpoints eligible for JSON Schema routing, not a guarantee of model-level conformance. Strict reviews should send `response_format.type=json_schema` with `provider.require_parameters=true`, then retain local schema and evidence acceptance as authoritative gates.

**Why:** Provider documentation allows endpoint-specific implementations to treat schemas as hints, and live free-model responses still arrived malformed or truncated after structured-output routing.

**How to apply:** Use metadata to avoid incompatible endpoints, but classify malformed or length-truncated content as incomplete and do not promote it based on the advertised capability alone.

Exact-model empirical probes must not hide contract failures behind a second model attempt: cap provider fallback at one candidate and stop agent retries after the first response. A parsed-provider response that fails JSON/schema acceptance is an incomplete measurement, not provider unavailability; reserve UNAVAILABLE for runs blocked by timeouts or provider outages.

**Why:** Apodex advertised structured-output support at the model level, but its selected Novita endpoint rejected JSON Schema and then returned malformed JSON in JSON-object mode. Automatic retries could change the model under test, while classifying malformed output as unavailable would hide the actual failure.

**How to apply:** Bind every empirical scorecard to the requested model, retain parser/schema failure codes without raw provider content, and distinguish execution/contract failures from provider health.

Exact-model probes must use a model registered in `FREE_MODELS` with metadata matching the task capability; the live `/models` snapshot filters this registry but does not add arbitrary live IDs as selectable candidates. Verify the resolver's selected model and the provider's requested/actual model against the probe ID before scoring. Discard a run if routing changed the model, and never use an unpinned random alias for a same-model probe.

**Why:** A currently free text model absent from the static catalog was silently ignored as an unusable override, and the resolver selected a different registered candidate. The scorecard's configured model alone did not reveal the mismatch.

**How to apply:** For a new live candidate, first verify its provider metadata and register it only if its capabilities fit the test; then assert model identity at resolver and provider-response boundaries before interpreting its scorecard.

Exact-model empirical campaigns must stop after the first provider-unavailable observation because the candidate can no longer pass the full corpus; record remaining case IDs as not run rather than issuing more requests or counting them as attempted failures. Scorecards should preserve the selected structured-output mode and any provider-reported model identity separately from the requested model.

**Why:** A repeated provider outage cannot improve an all-cases acceptance result, while additional calls can waste capacity or trigger a model-scoped upstream cooldown. Separating selected and reported identities prevents routing metadata from being mistaken for measured model identity.

**How to apply:** Break the existing campaign loop on provider unavailability, derive missing case IDs from the corpus, and keep output mode plus per-case reported model in the safe scorecard projection; do not add a parallel scheduler or cooldown store.

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

For empirical-quality runs, classify a typed `EMPTY_RESPONSE` (including a successful HTTP body with no usable `choices`) as provider unavailability, not a generic execution error or malformed JSON. It contains no model output to evaluate.

**Why:** OpenRouter free endpoints returned successful JSON-object-mode responses without choices after rejecting JSON Schema routing; treating that shape as a JavaScript exception obscured the actual provider failure.

**How to apply:** Normalize missing response fields into `EMPTY_RESPONSE` at the client boundary, preserve requested/actual model identity where available, and project it consistently as `PROVIDER_UNAVAILABLE` in empirical scorecards.

Prompt-only JSON is a separate empirical mode, not native structured-output support. It may be enabled only for an explicitly registered, exact-pinned review candidate; skip provider `response_format`, keep local schema and semantic/evidence acceptance unchanged, and stop before any cross-model fallback. Do not advertise this mode as the general `json` capability.

**Why:** A free text model may be eligible for a controlled E2 experiment without advertising `response_format`, but the normal code-review selector requires native JSON capability. Reclassifying it as natively structured would let it enter unrelated flows and obscure what the scorecard measured.

**How to apply:** Register prompt-only eligibility separately, route only the empirical candidate through a coding capability, record the selected and actual model, and allow the existing one same-model repair only after malformed/schema-invalid output—not after an empty response or provider outage.