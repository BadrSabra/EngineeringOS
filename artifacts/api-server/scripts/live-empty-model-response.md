# Controlled empty model response validation

Run this check only in a disposable validation environment:

```sh
RUN_LIVE_EMPTY_MODEL_RESPONSE=1 \
EMPTY_MODEL_RESPONSE_TEST_MODEL='<documented OpenRouter model>' \
pnpm run validate:live-empty-model-response
```

The command defaults to OpenRouter and requires `DATABASE_URL` and
`OPENROUTER_API_KEY`. A second provider-backed scenario is available as an
explicit opt-in matrix entry:

```sh
RUN_LIVE_EMPTY_MODEL_RESPONSE=1 \
EMPTY_MODEL_RESPONSE_TEST_PROVIDER=gemini \
EMPTY_MODEL_RESPONSE_TEST_MODEL='<documented Gemini model>' \
GEMINI_API_KEY='<provider credential from the environment>' \
pnpm run validate:live-empty-model-response
```

The provider key is selected by the provider (`OPENROUTER_API_KEY` for
`openrouter`, `GEMINI_API_KEY` for `gemini`); credentials are never required by
ordinary tests and neither command runs as part of `pnpm test`, normal API
validation, deployment, or dashboard checks. The model must be configured by
the operator to return no final text for the controlled prompt; a normal
completion is a contract mismatch and exits nonzero.

The scenario uses a temporary project root and removes it in the test
teardown. It asserts the parser's `EMPTY_MODEL_RESPONSE` classification,
completed server-owned reads, the `ANALYSIS_INCOMPLETE` report, next-step
guidance, and the absence of a Finding, `NO_VERIFIED_FINDING`, raw provider
diagnostics, or credentials for each selected provider. Provider/model
nondeterminism should be treated as a failed validation, not silently retried
with another provider.

Provider-shaped empty-final fixtures for both OpenRouter and Gemini run in the
normal provider-free `@workspace/ai-orchestrator` test suite. That deterministic
matrix covers the same incomplete-report, redaction, completed-read, and
temporary-root cleanup contract without contacting either provider.