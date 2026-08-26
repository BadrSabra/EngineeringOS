# Live-quality benchmark review — 2026-08-26

## Decision

**Blocked — not eligible for live-quality baseline approval or rollout.**

This is a provider-quality review artifact from an explicitly opted-in disposable
campaign. It is not a replacement for the deterministic contract baseline and it
does not authorize rollout.

## Campaign identity

- Suite: `flight-deck-v2`
- Campaign mode: `coverage`
- Campaign status: `coverage-complete`
- Cases: 34/34
- Source revision: `b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a`
- Candidate hash: recorded in `code-agent-benchmark-airlock.run.json`
- Provider lane: OpenRouter, with the server-observed usable model recorded in the run artifact

## Governance review

- Provider health was usable before case execution, but runtime provider availability degraded during the campaign.
- Grade counts: `A=0`, `B=0`, `C=0`, `D=0`, `F=2`, `U=32`.
- Provider-unavailable observations, failing cases, and the coverage-only campaign mode block rollout.
- The campaign is complete for coverage, but it is not a clean witness and cannot be approved as a baseline.
- The deterministic contract baseline remains unchanged and remains `qualityEligible: false` / `rolloutAllowed: false`.
- No thresholds were changed and no provider failure was generalized into success.

See the JSON run and parity report beside this review for the bounded case-level
and acceptance evidence. Raw provider output and credentials are not persisted.
