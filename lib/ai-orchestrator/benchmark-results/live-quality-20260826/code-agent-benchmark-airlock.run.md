# Code Agent Benchmark Scorecard

Suite: flight-deck-v2
Generated: 2026-08-26T01:07:19.615Z
Candidate hash: 1af4eb3a4cdaab1edfedbf9e94f04310d8738ab9e18f82f50bdebc54e7f28e5c
Source revision: b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a
Rollout allowed: no
Baseline gate: regressed

## Metrics

- Cases: 34/34
- First-attempt rate: 0
- Repaired within three attempts: 0
- Correct completion rate: 0
- Safely blocked rate: 0
- Provider unavailable cases: 32
- False success rate: 0
- Scope escape rate: 0
- Average tool calls: 0
- Average repair attempts: 0

## Grade counts

- A: 0
- B: 0
- C: 0
- D: 0
- F: 2
- U: 32

## D explanations

- None

## Rollout blockers

- provider unavailable for 32 observed cases
- failing benchmark case detected
- behavioral oracle missing or failed for 2 observed cases
- coverage campaign is not a clean witness; run a clean-witness campaign before baseline approval
- first-attempt rate regressed by 0.412 vs baseline
- repair success rate regressed by 0.588 vs baseline
- correct completion rate regressed by 1.000 vs baseline
- safe block rate regressed by 0.412 vs baseline

## Autonomous delivery acceptance

This bounded, redacted summary measures verified delivery separately from the
quality scorecard. Deterministic release checks do not depend on it.

- Completion rate: 0
- Safely blocked rate: 0
- Failure rate: 0.058823529411764705
- Uncertainty rate: 0.9411764705882353
- Recovery rate: 0
- Scope escape rate: 0
- Repeated side-effect rate: 0
- Verified completions: 0/34

### Operations

- airlock-1787706439615:single-file-001 (single-file-001): failed; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:single-file-002 (single-file-002): failed; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:single-file-003 (single-file-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:single-file-004 (single-file-004): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:multi-file-001 (multi-file-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:multi-file-002 (multi-file-002): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:multi-file-003 (multi-file-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:multi-file-004 (multi-file-004): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:test-failure-001 (test-failure-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:test-failure-002 (test-failure-002): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:test-failure-003 (test-failure-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:test-failure-004 (test-failure-004): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:typecheck-failure-001 (typecheck-failure-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:typecheck-failure-002 (typecheck-failure-002): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:typecheck-failure-003 (typecheck-failure-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:typecheck-failure-004 (typecheck-failure-004): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:dependency-graph-001 (dependency-graph-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:dependency-graph-002 (dependency-graph-002): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:dependency-graph-003 (dependency-graph-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:conflict-001 (conflict-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:conflict-002 (conflict-002): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:conflict-003 (conflict-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:cancellation-001 (cancellation-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:scope-001 (scope-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:malformed-output-001 (malformed-output-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:blocked-proof-001 (blocked-proof-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:broad-001 (broad-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:broad-002 (broad-002): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:broad-003 (broad-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:broad-004 (broad-004): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:blocked-001 (blocked-001): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:blocked-002 (blocked-002): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:blocked-003 (blocked-003): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false
- airlock-1787706439615:blocked-004 (blocked-004): uncertain; verified=false; recovered=false; scopeViolation=false; repeatedSideEffect=false

# Observable code-agent parity report

This report measures retained EngineeringOS outcomes only. It does not claim access to or infer undocumented comparator behavior.

- Campaign: coverage / coverage-complete
- Cases: 34/34
- Quality eligible: false

## Dimensions

| Dimension | Cases | Observed | Quality pass rate | Files read / tool call |
| --- | ---: | ---: | ---: | ---: |
| inspect-and-plan | 8 | 8 | 0 | n/a |
| multi-file-mutation | 7 | 7 | n/a | n/a |
| validation-and-repair | 8 | 8 | n/a | n/a |
| recovery-and-cancellation | 4 | 4 | n/a | n/a |
| scope-and-false-success | 7 | 7 | n/a | n/a |

## Gap table

| Priority | Dimension | Status | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| high | inspect-and-plan | observed-gap | Observed quality pass rate is 0. | Keep bounded read/plan acceptance coverage green before mutation. |
| medium | provider-availability | environment-gap | 32 provider-unavailable observation(s); U is excluded from quality rates. | Retry only in an explicitly opted-in disposable campaign; do not convert U into quality evidence. |

## Prioritized remediation

1. **high — inspect-and-plan:** Keep bounded read/plan acceptance coverage green before mutation.
2. **medium — provider-availability:** Retry only in an explicitly opted-in disposable campaign; do not convert U into quality evidence.

