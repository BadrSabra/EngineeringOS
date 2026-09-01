# Empirical AI quality campaign

EngineeringOS now has a separate, opt-in empirical quality layer for comparing
provider/model observations with reviewed ground truth. It is measurement
evidence, not a release authority.

## Corpus contract

The corpus is a versioned JSON manifest with no source bodies:

```json
{
  "kind": "empirical-ai-quality-corpus",
  "version": 1,
  "corpusRevision": "public-disposable-2026-09",
  "cases": [
    {
      "id": "repo-defect-001",
      "repositoryId": "public-repo-a",
      "sourceRevision": "sha256-...",
      "outcome": "defect",
      "expectedVerdict": "findings",
      "expectedGateDecision": "accept",
      "findings": [
        {
          "id": "finding-001",
          "file": "src/auth.ts",
          "lineStart": 42,
          "type": "security",
          "severity": "high"
        }
      ]
    },
    {
      "id": "repo-clean-001",
      "repositoryId": "public-repo-b",
      "sourceRevision": "sha256-...",
      "outcome": "clean",
      "expectedVerdict": "clean",
      "expectedGateDecision": "accept",
      "findings": []
    }
  ]
}
```

Corpus validation fails closed unless both defect and clean controls exist,
each defect has at least one annotation, paths are relative, revisions are
present, and finding IDs are unique. Source snapshots are supplied to the
campaign executor from disposable workspaces; they are never written to the
scorecard.

## Scoring an opt-in campaign

Provider adapters should call
`runEmpiricalQualityCampaign({ corpus, executeCase, provider, model })`. The
executor returns only bounded observations: terminal outcome, contract result,
semantic verdict, finding metadata, citation support flags, normalization
counters, and latency. It must not return prompts, responses, source bodies,
patches, absolute paths, or credentials.

For adapters that already collected bounded observations, the provider-free
report writer is:

```sh
RUN_EMPIRICAL_QUALITY_CAMPAIGN=1 \
EMPIRICAL_QUALITY_CORPUS_PATH=/path/to/reviewed-corpus.json \
EMPIRICAL_QUALITY_OBSERVATIONS_PATH=/path/to/bounded-observations.json \
EMPIRICAL_QUALITY_PROVIDER=openrouter \
EMPIRICAL_QUALITY_MODEL=provider/model \
pnpm --filter @workspace/ai-orchestrator run benchmark:empirical-quality:score
```

Set `EMPIRICAL_QUALITY_SCORECARD_PATH` to place the report elsewhere. Missing
observations become `ERROR`; provider unavailability and timeouts remain
separate from quality false positives/false negatives. The command exits
non-zero for an incomplete campaign.

## Report and dashboard behavior

The API reads the bounded report from
`EMPIRICAL_QUALITY_SCORECARD_PATH`, or from
`lib/ai-orchestrator/benchmark-results/empirical-quality-scorecard.json` by
default:

- `GET /api/ai/benchmark/empirical-scorecard`
- `GET /api/ai/mission-control` under `benchmark.empiricalCampaign`

Mission Control also shows the deterministic release gate separately under
`benchmark.releaseGate`. Empirical results never change `rolloutAllowed`,
baseline approval, release exit status, or ordinary CI behavior.

Live provider and authenticated Preview runs remain explicitly opt-in,
disposable, time-bounded, and redacted. A complete contract scorecard is not
itself evidence that empirical provider quality has been proven.