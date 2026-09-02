# Empirical AI quality campaign

EngineeringOS has a separate, opt-in empirical quality layer for comparing
provider/model observations with reviewed ground truth. It is measurement
evidence, not a release authority. The current checked-in revision is
`public-reviewed-2026-09-v2`; the original v1 manifest remains unchanged and
reproducible.

## Corpus contract

The corpus is a versioned JSON manifest with no source bodies. Corpus format v1
continues to validate for historical reproducibility. Format v2 adds safe
metadata and a declared minimum coverage matrix:

```json
{
  "kind": "empirical-ai-quality-corpus",
  "version": 2,
  "corpusRevision": "public-reviewed-2026-09-v2",
  "coverage": {
    "minimumCasesPerOutcome": 6,
    "requiredLanguages": ["javascript", "python", "go", "rust", "java", "csharp"],
    "requiredReviewPatterns": ["single-file", "multi-file"],
    "requiredIssueTypes": ["bug", "security", "performance", "style", "architecture"],
    "requiredSeverities": ["critical", "high", "medium", "low"]
  },
  "cases": [
    {
      "id": "repo-defect-001",
      "repositoryId": "public-repo-a",
      "repositoryUrl": "https://github.com/org/repository.git",
      "sourceRevision": "0123456789abcdef0123456789abcdef01234567",
      "selectedFiles": ["src/auth.ts"],
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
      ],
      "metadata": {
        "language": "javascript",
        "caseType": "defect",
        "reviewPattern": "single-file",
        "issueTypes": ["security"],
        "severities": ["high"]
      }
    },
    {
      "id": "repo-clean-001",
      "repositoryId": "public-repo-b",
      "sourceRevision": "sha256-...",
      "outcome": "clean",
      "expectedVerdict": "clean",
      "expectedGateDecision": "accept",
      "findings": [],
      "metadata": {
        "language": "javascript",
        "caseType": "clean",
        "reviewPattern": "multi-file",
        "issueTypes": [],
        "severities": []
      }
    }
  ]
}
```

Corpus validation fails closed unless both defect and clean controls exist,
each defect has at least one annotation, paths are relative, revisions are
present, repository URLs are credential-free HTTPS GitHub URLs, selected files
are bounded, and finding IDs are unique. V2 additionally requires:

- defect and clean controls to be balanced;
- metadata to use only the supported language, case type, review-pattern,
  issue-type, and severity values;
- metadata to match the outcome, selected-file shape, and ground-truth
  findings; and
- the declared minimum language, review-pattern, issue-type, and severity
  matrix to be present.

The v2 manifest contains six defect and six clean controls across JavaScript,
Python, Go, Rust, Java, and C#. Defects use single-file reviews and clean
controls use multi-file reviews. The six defects collectively cover security,
performance, architecture, bug, and style findings at critical, high, medium,
and low severity. These are metadata-only reporting dimensions; they do not
copy source bodies or provider responses into measurement artifacts.

The checked-in `reviewed-empirical-quality-corpus-v1.json` is the initial public
reviewed corpus and must not be rewritten when a new revision is published.
Each future revision should add a new immutable manifest, use public
credential-free repository URLs and full commit SHAs, keep selected files
relative and bounded, and have a reviewer confirm every finding against only
the listed files. Compare revisions by corpus revision and coverage matrix;
never mix scorecards from different revisions as if they were one sample.
Source snapshots are checked out at pinned revisions into a fresh host
disposable workspace for each case; they are never written to the scorecard.

## Corpus provenance preflight

Before spending disposable provider time, maintainers can opt in to a
provider-free GitHub metadata check:

```sh
RUN_EMPIRICAL_QUALITY_CORPUS_PREFLIGHT=1 \
pnpm --filter @workspace/api-server run validate:empirical-quality-corpus
```

The command defaults to the checked-in
`lib/ai-orchestrator/src/benchmark-fixtures/reviewed-empirical-quality-corpus-v2.json`.
Set `EMPIRICAL_QUALITY_CORPUS_PATH=/path/to/reviewed-corpus.json` to verify a
different, explicitly selected v1 or v2 manifest. The path is used only to
load the manifest; it is never printed in the report. The preflight is
separate from `RUN_EMPIRICAL_QUALITY_CAMPAIGN` and never needs an AI provider
key.

For every case, the preflight requests only GitHub commit and tree metadata. It
checks that the pinned commit belongs to the declared repository and that each
selected path is an exact regular blob at that revision. Missing revisions or
paths, repository mismatches, directories, symlinks, submodules, malformed
metadata, and rate limits are never reported as verified. No source blobs,
prompts, provider responses, credentials, or checkout workspaces are read or
persisted.

The command prints a bounded JSON summary containing the corpus revision and
case/repository/revision/path statuses. Exit status `0` means every case and
selected path was verified, `2` means a malformed corpus or known provenance
failure, and `3` means metadata could not be established because of a
transport, rate-limit, or tool failure. Retry status `3` after the network or
GitHub rate limit is available; do not treat it as a verified corpus.

Run this preflight first, then run the existing disposable campaign with its
separate provider and disposable flags. The preflight does not write
scorecards and is not consumed by release gates, rollout decisions, baseline
approval, dashboard decisions, ordinary tests, or ordinary CI. Compare v1 and
v2 campaigns by their immutable `corpusRevision`; do not mix their scorecards.

## Scoring an opt-in campaign

Provider adapters should call
`runEmpiricalQualityCampaign({ corpus, executeCase, provider, model })`. The
executor returns only bounded observations: terminal outcome, contract result,
semantic verdict, finding metadata, citation support flags, normalization
counters, and latency. It must not return prompts, responses, source bodies,
patches, absolute paths, or credentials.

The API server's live adapter clones each public repository without
credentials, fetches and detaches the exact manifest revision, reads only the
manifest's selected files, and removes the workspace after the case finishes.
Every selected file must be a regular file no larger than 50,000 bytes. The
adapter reads the complete file and checks that it did not change while being
read. Missing, changing, oversized, or otherwise incomplete evidence produces
an `ERROR` case with `INCOMPLETE_EVIDENCE`, keeps the campaign incomplete, and
never invokes the reviewer for that case; it is not silently scored as a
complete review.
It requires both `RUN_EMPIRICAL_QUALITY_CAMPAIGN=1` and
`EMPIRICAL_QUALITY_DISPOSABLE=1`; case and campaign timeouts are bounded by
default and can only be shortened through the explicit environment settings.

Run the real provider adapter only with a disposable output path:

```sh
RUN_EMPIRICAL_QUALITY_CAMPAIGN=1 \
EMPIRICAL_QUALITY_DISPOSABLE=1 \
EMPIRICAL_QUALITY_PROVIDER=openrouter \
EMPIRICAL_QUALITY_MODEL=provider/model \
EMPIRICAL_QUALITY_SCORECARD_PATH=/tmp/engineeringos-empirical/scorecard.json \
pnpm --filter @workspace/api-server run validate:empirical-quality
```

When no `EMPIRICAL_QUALITY_CORPUS_PATH` is supplied, the opt-in API campaign
uses `reviewed-empirical-quality-corpus-v2.json`. Supplying a path is useful
for reproducing the unchanged v1 campaign or comparing a separately reviewed
revision.

The adapter records provider unavailability, timeout, execution error, review
contract, citation, normalization, and latency outcomes in the empirical
scorecard. A failed or incomplete run is review evidence only and never
updates the deterministic release gate or rollout posture.

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