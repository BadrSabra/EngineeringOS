# Live structured-review provider campaign

This campaign is a credential-gated observation, not part of the normal
provider-free release checks. Run it only against a disposable project and
repeat it once per scenario:

```sh
RUN_LIVE_PROVIDER_REVIEW_CAMPAIGN=1 \
LIVE_REVIEW_DISPOSABLE=1 \
LIVE_REVIEW_PROVIDER=openrouter \
LIVE_REVIEW_SCENARIO=rate-limit \
LIVE_REVIEW_PROJECT_ID=<disposable-project-id> \
LIVE_REVIEW_MODEL=<documented-model> \
LIVE_REVIEW_OUTPUT_PATH=test-results/live-provider-review.json \
pnpm run validate:live-provider-review
```

Supported scenarios are `reasoning-only`, `agent-harness`, `rate-limit`,
`empty`, and `malformed`. The selected model/provider must be configured to
exercise the scenario; the campaign records the observed result and does not
pretend that a provider response was reproduced when it was not.

The runner requires the provider key in its corresponding environment variable
(`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, or `GROQ_API_KEY`).
It suppresses child diagnostics and writes only a versioned receipt containing
allowlisted provider/error metadata, bounded attempted model identifiers, and
at most one selected-file finding hash. Provider messages, response bodies,
prompts, source contents, runtime paths, and credentials are never persisted.

An accepted selected-file finding is recorded as `fallback-success` with
`terminalStatus=COMPLETE`. Provider outages, model-availability failures,
empty output, and malformed output are recorded as
`terminal-incomplete` with `terminalStatus=INCOMPLETE` and no evidence.