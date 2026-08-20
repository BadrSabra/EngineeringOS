# Controlled empty model response validation

Run this check only in a disposable validation environment:

```sh
RUN_LIVE_EMPTY_MODEL_RESPONSE=1 \
EMPTY_MODEL_RESPONSE_TEST_MODEL='<documented OpenRouter model>' \
pnpm run validate:live-empty-model-response
```

The command also requires `DATABASE_URL` and `OPENROUTER_API_KEY`. It never
runs as part of `pnpm test`, the normal API validation, deployment, or
dashboard checks. The model must be configured by the operator to return no
final text for the controlled prompt; a normal completion is a contract
mismatch and exits nonzero.

The scenario uses a temporary project root and removes it in the test
teardown. It asserts the parser's `EMPTY_MODEL_RESPONSE` classification,
completed server-owned reads, the `ANALYSIS_INCOMPLETE` report, next-step
guidance, and the absence of a Finding, `NO_VERIFIED_FINDING`, raw provider
diagnostics, or credentials. Provider/model nondeterminism should be treated
as a failed validation, not silently retried with another provider.