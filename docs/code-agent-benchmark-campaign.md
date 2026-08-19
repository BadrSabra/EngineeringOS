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

The quality scorecard excludes `U` from quality rates, but `U` remains a
rollout blocker and prevents baseline approval.