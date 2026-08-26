# Baseline governance

EngineeringOS has two intentionally separate baseline authorities:

| Baseline | Authority | Schema/version | Approval path |
| --- | --- | --- | --- |
| Truth Flow Matrix | `EXPECTED_CURRENT_TRUTH_FLOW_MATRIX` in `lib/api-zod/src/truth-flow-matrix.schema.ts` | `CurrentTruthFlowMatrixSchema`, matrix version `1.0.0` | Deliberate schema edit, materialize JSON, inspect the focused diff, then run `truth:baseline:check` and `truth:validate` |
| Code Agent Benchmark | The benchmark suite and its explicit approved benchmark artifacts | Code Agent Benchmark schema version `1`, suite version `flight-deck-v2` | Run the deterministic contract replay or an approved live campaign, review its suite/version and case comparison, then run `benchmark:baseline:check`; live quality approval is separate |

Neither baseline may be generated from the other. Runtime output and historical
files can inform a proposed engineering decision, but cannot silently change
either authority.

## Truth Flow changes

1. Make the reviewed change in the exported schema constant.
2. Run `pnpm run truth:baseline:materialize`.
3. Inspect the generated diff; unrelated node, status, confidence, path, or
   action changes are a failed review.
4. Run `pnpm run truth:baseline:check` and `pnpm run truth:validate`.

Missing JSON fails with an actionable materialization command. No historical
file or runtime result is used as a fallback.

## Code Agent Benchmark changes

`pnpm run benchmark:baseline:check` independently verifies the checked-in
provider-free deterministic contract baseline against the current suite version,
schema version, complete case list/order, and its explicit
`qualityEligible: false` / `rolloutAllowed: false` safety markers. A suite,
case corpus, or baseline version change fails loudly until the corresponding
comparison is regenerated and explicitly reviewed.

The deterministic artifact proves only that the suite and terminal-contract
grading rules agree. It is not proof of live agent quality, rollout readiness,
or provider performance. Live benchmark baselines require their own approved
comparison and remain subject to the release quality gate.

## Live-quality review record

The 2026-08-26 disposable OpenRouter campaign is retained at
`lib/ai-orchestrator/benchmark-results/live-quality-20260826/`. It observed all
34 cases and records the server-owned source revision and candidate hash, but
its coverage campaign contains provider-unavailable and failing observations.
The review therefore remains blocked and is not an approved live-quality
baseline. The deterministic contract baseline is unchanged.