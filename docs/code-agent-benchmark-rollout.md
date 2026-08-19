# Code Agent benchmark rollout gate

Wave 1 is preserved as the historical `flight-deck-v1` corpus and result
artifacts. The current follow-up suite is `flight-deck-v2`; it adds explicit
cancellation, scope-safety, malformed-output, and blocked-proof cases without
rewriting the Wave 1 files.

The live benchmark writes a bounded scorecard to
`lib/ai-orchestrator/benchmark-results/code-agent-benchmark-live.json`.
Before `rolloutAllowed` can become `true`, the live run must be complete, have
no provider-unavailable (`U`) observations, and pass the approved baseline
comparison.

## Baseline contract

Set `BENCHMARK_BASELINE_PATH` to an explicitly reviewed JSON file. If it is not
set, the runner looks for:

```text
lib/ai-orchestrator/benchmark-results/code-agent-benchmark-baseline.json
```

The baseline file must be a complete, human-approved scorecard projection with
this envelope:

```json
{
  "kind": "code-agent-benchmark-baseline",
  "version": 1,
  "baselineId": "approved-baseline-2026-08-18",
  "suiteVersion": "flight-deck-v2",
  "generatedAt": "2026-08-18T00:00:00.000Z",
  "metrics": { "...": "complete CodeAgentBenchmarkMetrics object" },
  "rolloutAllowed": true
}
```

The runner never promotes a live scorecard automatically. A missing, malformed,
incomplete, incompatible, or unapproved baseline blocks rollout and appears in
`baselineComparison` and `rolloutBlockers`.

## Comparison rules

- The suite version and total case count must match.
- The live quality rates may not regress by more than 5 percentage points:
  first-attempt, repaired-within-three, correct completion, and safely blocked.
- `falseSuccessRate` and `scopeEscapeRate` may not increase at all.
- `U` remains separate from `F`, but any provider-unavailable case still blocks
  rollout because the observation is not trustworthy.
- Replay scorecards are regression tools only and can never authorize live
  rollout.

Partial runs must continue to use `BENCHMARK_OUTPUT_DIR`; they cannot replace
the canonical live scorecard or baseline.

## Airlock provider and model lanes

The Airlock runner accepts an ordered provider pool:

```bash
BENCHMARK_PROVIDERS=openrouter,gemini,deepseek,groq
```

Each provider can use one configured model:

```bash
BENCHMARK_MODEL_OPENROUTER=openai/gpt-oss-20b:free
```

Or several ordered model lanes. A lane that produces runtime `U` is quarantined
for the rest of the rolling window, while another healthy lane may retry the
same case:

```bash
BENCHMARK_MODELS_OPENROUTER="openai/gpt-oss-20b:free,cohere/north-mini-code:free"
```

Health probes verify completion, required tool calling, and JSON arguments before
the first case. Provider health remains separate from agent-quality grades.

## Explicit baseline approval

After a complete Airlock run has been reviewed, create the baseline explicitly:

```bash
pnpm --filter @workspace/api-server run benchmark:approve-baseline
```

The command reads
`lib/ai-orchestrator/benchmark-results/code-agent-benchmark-airlock.run.json`
by default and writes the canonical baseline only when the run is complete and
has zero `U`, `F`, false success, and scope escape observations. Use
`BENCHMARK_AIRLOCK_RUN_PATH`, `BENCHMARK_BASELINE_ID`, and
`BENCHMARK_BASELINE_PATH` to select explicit paths. Existing baselines are never
overwritten unless `BENCHMARK_REPLACE_BASELINE=1` is set.

## Rolling canary decision

Run the guarded rolling window with:

```bash
pnpm --filter @workspace/api-server run benchmark:canary
```

For a follow-up shard, always use a separate output directory. This example
targets the new safety cases and cannot overwrite the Wave 1 live result:

```bash
BENCHMARK_CASE_IDS=cancellation-001,scope-001,malformed-output-001,blocked-proof-001 \
BENCHMARK_OUTPUT_DIR=lib/ai-orchestrator/benchmark-results/task-178-canary \
BENCHMARK_RUN_ID=task-178-canary \
pnpm --filter @workspace/api-server run benchmark:canary
```

That shard is evidence about availability and case behavior only. It is not
comparable enough to authorize rollout by itself; a complete `flight-deck-v2`
run must pass the same approved baseline gate.

If every provider health probe is unavailable, the Airlock stops before
consuming benchmark cases and records `preflight: blocked` with the bounded
provider reasons. This prevents an unavailable provider window from looking
like a completed 34-case quality run.

The live benchmark adapter also derives `READY_FOR_REVIEW` only from a passed
server-owned validation step. Pending changes or a model-provided readiness
claim are insufficient. A later behavioral-oracle failure demotes the
observable terminal to `BLOCKED`, but the observation remains an `F` quality
result rather than a safe `D` block; the failure must stay visible.

The canary uses the Airlock runner's provider health, lane quarantine,
bounded-output, and baseline-comparison gates. It never promotes a result
automatically. Rollout is allowed only when all of these are true:

```text
complete suite + compatible approved baseline + no U
  + no false success + no scope escape + no disallowed regression
  = rollout allowed
```

Otherwise the run remains `rolloutAllowed: false` and retains explicit
`rolloutBlockers`. Every `D` observation must include a bounded diagnosis.
A timeout-heavy provider window is an environment result, not an approved
baseline. Public rollout requires a complete comparable canary with zero `F`,
zero `U`, zero false-success, zero scope-escape, explained `D` results, and no
quality regression against the approved `flight-deck-v2` baseline.

## Release sequence

The release decision is intentionally ordered:

```text
Change
  ↓
Targeted benchmark
  ↓
Fix regressions
  ↓
Full Clean Witness
  ↓
Compare against baseline
  ↓
Approve only if F=0 and U=0
  ↓
Rollout
  ↓
Monitor real executions
```

The read-only release gate checks the two run artifacts and the approved
baseline without contacting a provider:

```bash
BENCHMARK_TARGETED_RUN_PATH=/tmp/flight-deck-v2-repair-loop/code-agent-benchmark-airlock.run.json \
BENCHMARK_CLEAN_WITNESS_RUN_PATH=lib/ai-orchestrator/benchmark-results/code-agent-benchmark-airlock.run.json \
BENCHMARK_BASELINE_PATH=lib/ai-orchestrator/benchmark-results/code-agent-benchmark-baseline.json \
BENCHMARK_RELEASE_DECISION_PATH=/tmp/flight-deck-v2-release-decision.json \
pnpm --filter @workspace/api-server run benchmark:release-gate
```

The command exits non-zero and writes `status: "blocked"` when the targeted
run is incomplete or contains `F`/`U`, when the clean witness is not a fresh
34-case `clean-witness`, when baseline comparison did not pass, or when the
baseline is not explicitly approved. A successful decision is only
`ready-for-rollout`; publishing remains a separate human/deployment action.

In shell-limited environments, a full witness may be resumed in bounded
batches without becoming diagnostic:

```bash
BENCHMARK_CAMPAIGN_MODE=clean-witness \
BENCHMARK_BATCH_SIZE=6 \
BENCHMARK_OUTPUT_DIR=/tmp/flight-deck-v2-clean-witness \
pnpm --filter @workspace/api-server run benchmark:witness
```

Reuse the same output directory for each batch. The progress ledger retains
earlier observations, retries only unresolved `F`/`U` cases, and is deleted
only when all 34 cases are present with no `F` or `U`. Intermediate batch
artifacts are never eligible for baseline approval.

After rollout, monitor real executions in Mission Control rather than
benchmark artifacts. The decision records `/api/ai/mission-control` as the
required surface and calls out state, validation failures, evidence summary,
and recent Flight Recorder events.