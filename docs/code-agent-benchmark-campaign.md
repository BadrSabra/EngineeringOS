# Code Agent Benchmark Campaigns

The `flight-deck-v2` benchmark is executed as a campaign, not as one
provider-dependent mega-run. Each case is checkpointed independently and
environment failures remain `U`; they are never converted to quality failures
or success.

## Campaign modes

### Coverage

Coverage observes every requested case. If all provider lanes become
unavailable, the runner records bounded `U` observations for the remaining
cases and continues to `34/34`.

```bash
BENCHMARK_OUTPUT_DIR=/tmp/flight-deck-v2-campaign \
BENCHMARK_CAMPAIGN_MODE=coverage \
pnpm --filter @workspace/api-server run benchmark:airlock
```

Coverage artifacts are diagnostic only. They always contain the blocker:

```text
coverage campaign is not a clean witness; run a clean-witness campaign before baseline approval
```

The progress ledger is intentionally retained after complete coverage so that
the recovery campaign can consume its `U` and `F` queue.

### Recovery

Recovery re-runs only cases whose latest persisted observation is `U` or `F`.
Earlier observations are retained in the ledger and replaced only for the
case that was actually retried.

```bash
BENCHMARK_OUTPUT_DIR=/tmp/flight-deck-v2-campaign \
pnpm --filter @workspace/api-server run benchmark:recovery
```

Recovery artifacts are never eligible as a baseline, even if every retried
case passes. A recovery run is not a full-suite witness.

### Clean witness

A clean witness is a fresh, complete run of all 34 cases with no `U`, no `F`,
no false success, and no scope escape.

```bash
BENCHMARK_OUTPUT_DIR=/tmp/flight-deck-v2-campaign \
pnpm --filter @workspace/api-server run benchmark:witness
```

Only this artifact can be approved as a baseline. Targeted runs, shards,
coverage runs, and recovery-only runs are rejected by the approval command.

```bash
BENCHMARK_AIRLOCK_RUN_PATH=/tmp/flight-deck-v2-campaign/code-agent-benchmark-airlock.run.json \
BENCHMARK_BASELINE_ID=baseline-flight-deck-v2-reviewed \
pnpm --filter @workspace/api-server run benchmark:approve-baseline
```

Approval is still explicit and never replaces an existing baseline unless
`BENCHMARK_REPLACE_BASELINE=1` is supplied.

### Targeted runs

Use a server-owned profile after a focused change instead of consuming all
34 cases. The profile order is deterministic and the output must use a
separate `BENCHMARK_OUTPUT_DIR`:

```bash
BENCHMARK_TARGET_PROFILE=repair-loop \
BENCHMARK_OUTPUT_DIR=/tmp/flight-deck-v2-repair-loop \
pnpm --filter @workspace/api-server run benchmark:airlock
```

Available profiles:

- `repair-loop`: test and typecheck repair, including a bounded blocked retry.
- `scope-enforcement`: scope escape, conflict rebase, and blocked out-of-scope writes.
- `provider-fallback`: cancellation and unavailable-validation recovery cases.
- `forensic-routing`: test-source execution and fixture-only/blocked proof cases.

`BENCHMARK_TARGETED=true` remains available for the legacy six-case smoke
matrix, and `BENCHMARK_CASE_IDS=a,b,c` remains available for an explicitly
named custom subset. These modes cannot be combined with each other or with
benchmark sharding, and all write a diagnostic-only artifact.

Targeted runs are for feedback only. They carry `targeted: true`,
`partial: true`, `diagnosticOnly: true`, `baselineEligibility: "not-eligible"`,
a bounded target profile/case list, and a rollout blocker stating that a full
clean witness is required. They must never be used to create or replace a
baseline.

## Failure-to-fixture protocol

Every new failure becomes a permanent regression fixture. Do not weaken an
oracle, remove a strong assertion, or broaden an expected terminal just to
make the failing run pass.

For each new failure:

1. Add a new server-owned case to the manifest with a stable ID and retain the
   original prompt.
2. Add executable fixture setup that reproduces the failure in an isolated
   workspace.
3. Add the semantic postcondition and behavioral/runtime proof. The proof must
   reject a missing change, a weakened test, and an equivalent-but-wrong
   implementation where relevant.
4. Add the case to the appropriate target profile. Keep the profile order
   server-owned; caller-provided ordering is not a substitute.
5. Run the case alone:

   ```bash
   BENCHMARK_CASE_IDS=<case-id> \
   BENCHMARK_OUTPUT_DIR=/tmp/flight-deck-v2-case-<case-id> \
   BENCHMARK_RUN_ID=case-<case-id> \
   pnpm --filter @workspace/api-server run benchmark:airlock
   ```

6. Fix the agent, prompt, or tool contract until the isolated case passes
   without weakening its oracle.
7. Run the relevant targeted profile:

   ```bash
   BENCHMARK_TARGET_PROFILE=<profile> \
   BENCHMARK_OUTPUT_DIR=/tmp/flight-deck-v2-<profile> \
   pnpm --filter @workspace/api-server run benchmark:airlock
   ```

8. Only after the single case and targeted profile pass, run a fresh
   `clean-witness` campaign. A targeted artifact is never promoted or merged
   into the canonical baseline.

The fixture contract is checked before the API benchmark consumes a provider.
Each case must retain its manifest prompt, non-empty setup and postcondition,
server-owned target scope, and executable behavioral or runtime proof.

## Artifact contract

Each Airlock run includes:

- `campaignMode`: `coverage` or `clean-witness`
- `campaignStatus`: `incomplete`, `coverage-complete`, or `clean-witness`
- `recoveryCaseIds`: bounded `U`/`F` queue
- `recoveryOnly`: whether the run was a partial recovery pass
- `diagnosticOnly`, `targeted`, `partial`, and optional `targetProfile` for
  targeted/partial feedback runs
- `baselineEligibility`: targeted/partial artifacts are explicitly
  `"not-eligible"`
- per-case `providerAttempts`, provider/model identity, and bounded observation
- `autonomousDeliveryAcceptance`, a bounded redacted summary keyed by
  `operationId` and `caseId`. It reports completion, safe blocking, failure,
  uncertainty, recovery, scope escape, repeated side effects, and the
  verified-completion count. Provider output, source text, patches, and
  credentials are never included.

The quality scorecard excludes `U` from quality rates, but `U` remains a
rollout blocker and prevents baseline approval.

## Unified operation-loop acceptance

The benchmark scorecard is a case-quality report. The separate
`autonomous-delivery-acceptance` reducer is the acceptance boundary for
measuring the Task #46 unified operation loop. Its input is a bounded receipt
per operation, keyed by `operationId` and `caseId`; it never starts an
operation, writes production state, or treats an HTTP/model success as proof.

Each receipt has exactly one terminal outcome:

- `completed`: delivery is verified against the candidate bytes;
- `safely-blocked`: the system stopped with a known safety or evidence reason;
- `failed`: execution produced a known failure;
- `uncertain`: evidence was missing, interrupted, or could not be reconciled.

Recovery, scope violation, and repeated side effects are reported separately
from terminal outcome. A completed receipt with an escape or repeated side
effect is not counted as a verified completion. Duplicate operation identities
and unverifiable completions fail closed.

The campaign policy is deterministic by default. Provider, browser,
deployment, and remote-delivery lanes must each be explicitly enabled and
still require isolated workspaces and redacted receipts. These lanes are
measurement-only and must not be added to the production operation path or
make deterministic release checks depend on external availability.

Live benchmark campaigns require both an explicit opt-in and a disposable
output directory outside the repository:

```bash
BENCHMARK_LIVE_CAMPAIGN=1 \
BENCHMARK_OUTPUT_DIR=/tmp/engineeringos-live-campaign \
BENCHMARK_CAMPAIGN_TIMEOUT_MS=900000 \
pnpm --filter @workspace/api-server run benchmark:airlock
```

The live runner also creates a temporary isolated source workspace and removes
it after the campaign. `BENCHMARK_CAMPAIGN_TIMEOUT_MS` bounds the complete
campaign, while per-case timeouts remain independently configurable. Live
results are evidence for review only; they are never consumed as the
deterministic release gate.

Representative fixture coverage is the existing 34-case manifest: single and
multi-file edits, test/typecheck repair, dependency and conflict recovery,
cancellation, scope enforcement, malformed output, decomposition, and safely
blocked evidence. No production repository or production execution data is
used as campaign input.