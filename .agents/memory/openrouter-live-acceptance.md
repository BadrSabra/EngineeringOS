---
name: OpenRouter live acceptance
description: Operational distinction between authenticated provider responses and accepted structured-review evidence.
---

OpenRouter catalog access and a successful completion are not sufficient for a live review pass. The campaign must separately prove structured-output acceptance and retained file evidence; free-model contract failures and agentic-harness restrictions stay incomplete rather than spending on paid models. The disposable review fixture must contain one intentional, bounded defect so a valid response has a concrete selected-file finding to cite; a clean fixture cannot prove evidence acceptance. A classified free rate/quota failure may make one explicit paid attempt, and the receipt must show both tiers even when the paid attempt terminates before a parsed response. Full-source runs can additionally expose malformed tool-call output and telemetry/evidence-count mismatches; those are non-success until the server-owned acceptance gate closes. Partial/truncated prefetch bodies may remain available for coverage diagnostics, but must never be promoted into complete evidence records or completed-read counts.

**Why:** Live free models can return useful text while failing the review JSON contract, and OpenRouter can gate individual free models even when the credential and catalog are healthy. Treating provider success as acceptance would create false proof. A clean review result is also semantically incompatible with a campaign that requires one selected-file finding. Larger source scopes increase the chance of finding mismatched read/evidence accounting that a small fixture does not exercise.

**How to apply:** Keep provider readiness, model fallback, contract parsing, evidence correlation, and final acceptance as separate gates in future live campaigns and release receipts. When reconciling a run, pass partial prefetch paths explicitly so the ledger excludes them while the UI can still report incomplete coverage.

OpenRouter's public `/models` catalog does not attest that a model is eligible for the ordinary chat-completions endpoint. The model-specific endpoints API is restricted to management keys; do not infer endpoint eligibility from `supported_parameters` or maintain an unsupported static denylist. Agent-harness-only 400/403 responses remain model-unavailable failures, and bounded empirical campaigns stop rather than retrying the rejected route across cases.

**Why:** The documented endpoint-list operation returns 403 unless the caller has a management key, while public model metadata only describes model-level capabilities.

**How to apply:** Add a preflight only if the runtime gains documented access to endpoint eligibility data or another server-owned source; until then, keep the narrow failure classification and do not run broader campaigns after the model is rejected.

OpenRouter telemetry's `outputTextLength` measures only top-level `output_text`; a zero there does not mean `message.content` is empty. Some free endpoints return nonempty visible content that is malformed JSON, while others return an empty object or no message content. Reasoning metadata is separate and never substitutes for accepted structured output. Raising the code-review output budget from 2,048 to 4,096 tokens did not establish reliable acceptance.

**Why:** Live probes showed `contentLength` can be substantial while `outputTextLength` is zero; relying on the latter alone misclassifies malformed visible completions as reasoning-only output.

**How to apply:** Interpret `contentLength`, top-level `outputTextLength`, reasoning length, finish reason, and model identity separately. Keep malformed, empty, timed-out, and throttled cases incomplete; probe one candidate before spending the full corpus and stop when automatic fallback would change the model under test.

When a response is truncated (`finish_reason=length`) and fails local JSON parsing, the single same-model repair needs an explicit bounded output budget above the ceiling that was just exhausted; 8,192 tokens is not sufficient when reasoning consumes nearly all of it. Leave acceptance gates unchanged.

**Why:** A live Dots repair was cut off under the default budget, and Nemotron Lightning's 8,192-token repair ended at `finish_reason=length` after 8,027 reasoning tokens. Both failures pointed to output truncation, not grounds to relax JSON or evidence acceptance.

**How to apply:** Raise the budget only on that one repair attempt and only beyond the last observed cap; keep the exact model pinned. A 16,384-token Lightning repair completed with `finish_reason=stop` and passed the structured contract, but its finding still failed semantic/citation acceptance, so budget repair is not quality acceptance.

OpenRouter `structured_outputs` is coarse metadata, not proof that the chosen endpoint accepts `json_schema`. When both `response_format` and `structured_outputs` are advertised, prefer `json_object`; use schema mode only when it is the sole advertised native format. Keep `provider.require_parameters=true` for either strict native mode and retain local schema and evidence acceptance as authoritative gates.

**Why:** Provider documentation allows endpoint-specific implementations to treat schemas as hints; Apodex's selected Novita route explicitly rejected `json_schema` despite the catalog's `structured_outputs` flag, while advertising JSON-object support.

**How to apply:** Use the exact response-format signal to choose among native modes, treat `structured_outputs` alone as insufficient evidence for schema routing, and classify malformed or truncated content as incomplete.

Exact-model empirical probes must not hide contract failures behind a second model attempt: cap provider fallback at one candidate and stop agent retries after the first response. A parsed-provider response that fails JSON/schema acceptance is an incomplete measurement, not provider unavailability; reserve UNAVAILABLE for runs blocked by timeouts or provider outages.

**Why:** Apodex advertised structured-output support at the model level, but its selected Novita endpoint rejected JSON Schema and then returned malformed JSON in JSON-object mode. Automatic retries could change the model under test, while classifying malformed output as unavailable would hide the actual failure.

**How to apply:** Bind every empirical scorecard to the requested model, retain parser/schema failure codes without raw provider content, and distinguish execution/contract failures from provider health.

Exact-model probes must use a model registered in `FREE_MODELS` with metadata matching the task capability; the live `/models` snapshot filters this registry but does not add arbitrary live IDs as selectable candidates. Verify the resolver's selected model and the provider's requested/actual model against the probe ID before scoring. Discard a run if routing changed the model, and never use an unpinned random alias for a same-model probe.

**Why:** A currently free text model absent from the static catalog was silently ignored as an unusable override, and the resolver selected a different registered candidate. The scorecard's configured model alone did not reveal the mismatch.

**How to apply:** For a new live candidate, first verify its provider metadata and register it only if its capabilities fit the test; then assert model identity at resolver and provider-response boundaries before interpreting its scorecard.

Provider health `usable` does not prove a model supports the request's capability. The free catalog can advertise `tool_calling` without `chat`; a generic health probe may pass even though a chat-bound tool-loop request is rejected as `INVALID_CONFIG`.

**Why:** A free coding model passed provider health and tool-calling checks, but the live chat execution was rejected because its catalog metadata lacked `chat`.

**How to apply:** Before a chat-based benchmark attempt, verify `chat` and `tool_calling` in the registered model capabilities. Keep provider health and capability compatibility as separate gates; never treat the probe result as permission to retry an incompatible model.

Standalone `probeProviderHealth` calls do not hydrate OpenRouter credentials from the environment; pass the key explicitly without logging it, or `INVALID_CONFIG` may be mistaken for candidate incompatibility before any provider request occurs.

**Why:** A direct probe without its optional `apiKey` returned `INVALID_CONFIG` before contacting OpenRouter, while the benchmark runner supplies the key.

**How to apply:** In one-off capability probes, pass the existing secret through the `apiKey` option in-process and report only the safe probe result and model ID.

Pinned empirical campaigns can outlast the dynamic catalog's freshness window. Refresh an expired snapshot before each case's model-eligibility check; if the refreshed snapshot no longer lists the exact candidate as free, record provider unavailability and stop the pinned campaign rather than emitting generic execution errors for every remaining case.

**Why:** A long corpus run crossed the catalog TTL after several slow model responses. Per-case validation treated the expired snapshot's `null` as an ordinary exception, so later cases failed before review despite successful repository setup.

**How to apply:** Revalidate only after expiry, keep the same exact model binding, fail closed if refresh cannot establish current eligibility, and test both successful refresh and a candidate removed from the refreshed catalog.

Exact-model empirical campaigns must stop after the first provider-unavailable observation because the candidate can no longer pass the full corpus; record remaining case IDs as not run rather than issuing more requests or counting them as attempted failures. Scorecards should preserve the selected structured-output mode and any provider-reported model identity separately from the requested model.

**Why:** A repeated provider outage cannot improve an all-cases acceptance result, while additional calls can waste capacity or trigger a model-scoped upstream cooldown. Separating selected and reported identities prevents routing metadata from being mistaken for measured model identity.

**How to apply:** Break the pinned-model scorecard on provider unavailability, derive missing case IDs from the corpus, and keep output mode plus per-case reported model in the safe scorecard projection. If the user explicitly requests a multi-model campaign, launch the next eligible registered OpenRouter model as a separate scorecard with its own model binding; never mix model results or add a parallel fallback chain to the pinned run.

The Code Agent benchmark's provider-health probe is cached once per executor and gates every case. A failed preflight can therefore produce a full set of U rows without executing those cases. The bounded candidate walk should continue after a candidate timeout, but only a valid capability response may unlock case execution. Once cases have started, repeated request timeouts can still open the provider circuit and yield U; shared cooldown-store unavailability alone does not prove provider calls are blocked.

**Why:** A live run produced 34 U rows from one shared probe sequence (empty response, then timeout), not 34 independent task attempts. A bounded timeout fallback let a later candidate pass the same probe; a subsequent full campaign still had genuine per-case failures and circuit-open U results.

**How to apply:** Before interpreting U totals or comparing quality, verify whether case tool calls actually started. A long first-row latency followed by near-zero rows indicates a shared preflight failure; distinguish it from later per-case timeouts and circuit-open skips. Keep all results isolated from the canonical baseline until the release gate passes.

Case-level deadlines remain authoritative when the agent resolves normally after its abort signal. Check the deadline after each awaited execution, validation, and oracle stage; send expired cases through the same unavailable (U) projection as rejected timeout calls instead of scoring a late BLOCKED result as F.

**Why:** OpenRouter agent loops may handle cancellation internally and return a normal BLOCKED chat result. Catch-only timeout handling then mistakes an expired case for a quality failure.

**How to apply:** Preserve bounded partial telemetry, skip remaining validation/oracle work after the deadline, and classify the result as U at every asynchronous boundary.

Empirical-quality case timeouts cover repository checkout and selected-file preparation as well as the provider review. A timeout at the configured boundary is experiment-budget exhaustion, not evidence that the model returned malformed output or that the provider declared a timeout.

**Why:** A real review completed near 90 seconds while the empirical case was aborted at its 90-second end-to-end deadline; setup and review share that budget.

**How to apply:** Compare case latency with its configured deadline before assigning root cause. Use a larger budget for a later controlled run, while preserving the existing stop-on-timeout behavior for the current campaign.

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

Live review campaign wall-clock watchdogs must account for runtime startup in addition to measured provider latency. Keep exact-model receipt validation, but avoid a wrapper default so short that it terminates a valid review before the sanitized receipt is written.

**Why:** A valid free-model review took about 90 seconds of measured work but exceeded the campaign's 120-second wall-clock watchdog once process startup and setup were included; a longer bounded run produced a complete, evidence-backed receipt.

**How to apply:** Use a several-minute outer watchdog for the live review wrapper, retain a disposable workspace and bounded child termination, and inspect the safe receipt before deciding whether a provider failure needs code changes.

Exact-model Code Agent evaluations must cap provider fallback and disable the tool loop's same-model empty-response replay; otherwise a scorecard can mix attempts or consume retries that cannot improve the exact candidate's result. Provider protocol violations such as invalid tool calls are response-contract failures, not transport outages.

**Why:** Live campaign traces showed an empty model response replaying before a timeout, and a received invalid tool call being counted as provider unavailability. Those states have different implications for candidate quality and provider health.

**How to apply:** Bind all tool-loop calls in explicit-model evaluations to one candidate, do not replay EMPTY_RESPONSE in that mode, and classify INVALID_TOOL_CALL/INVALID_PROVIDER_RESPONSE separately from true timeout, network, quota, and service failures. Keep ordinary chat retry behavior unchanged.

For multi-model empirical quality evaluations, screen each exact candidate with a separately labeled balanced defect/control pair before running the canonical corpus. A pair is only a triage filter: require both cases to complete with exact model identity and no contract, citation, false-positive, or false-negative blockers before spending the full corpus. Stop a pinned card once a blocker makes `PROVEN` impossible; never report a pair result as full-corpus proof.

**Why:** The full-corpus scorecard is fail-closed, so later cases cannot restore `PROVEN` after an accepted-case blocker, while free endpoints may be slow, throttled, malformed, or unavailable.

**How to apply:** Give the pair its own corpus revision and scorecard for each candidate. Promote only a clean pair to the canonical corpus, keep model fallback disabled, and record skipped cases when a candidate fails early.