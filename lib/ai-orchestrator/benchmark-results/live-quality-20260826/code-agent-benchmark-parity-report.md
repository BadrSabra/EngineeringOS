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
