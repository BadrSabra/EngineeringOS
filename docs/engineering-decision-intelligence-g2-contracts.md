# EngineeringOS Decision Intelligence — G2 Contracts

## Gate result

- **G2: COMPLETE as shared, versioned contract definitions.**
- **G3: COMPLETE as a separate pure proposal generator/comparator; no live Mission dispatch integration.** See `docs/engineering-decision-intelligence-g3-generation.md`.
- **G4: COMPLETE as a pure conservative evaluator; no durable persistence or live Mission integration.** See `docs/engineering-decision-intelligence-g4-evaluation.md`.
**G5: trace storage layer verified; live Mission integration open.** See `docs/engineering-decision-intelligence-g5-persistence.md`.

The contracts live in the shared AI-orchestrator Agent State package and are exported through its public package entry point. They describe data and reject inconsistent identities; they are not an executor, an authorization mechanism, or a replacement for Canonical Proof, Acceptance, Approval, or World State validation.

## Contracts established

| Contract | What it binds | Safety condition |
|---|---|---|
| Decision Context | Project, Mission, Goal, trigger, source Execution/Attempt, prior plan revision, project/World State/environment revisions, diagnosis, evidence, authorization, capabilities, and unresolved observations | A recovery context requires its source Execution, Attempt, and prior plan revision. Evidence carries scope, timestamp, freshness, revisions, confidence provenance, eligibility, and a content hash. |
| Strategy Alternative | Strategy ID/version/source, objective, required capabilities/evidence, preconditions, plan-step references, expected observations/effects, validation, dependencies, cost/resource/duration estimates, risk, reversibility, failure modes, approvals, assumptions, and limitations | Unknown estimates remain null with an explicit status. The contract contains no shell text, arbitrary argv, or permission to execute. A candidate-sourced alternative must identify its registered candidate and hash. |
| Strategy Difference | Paired alternatives and semantic comparison dimensions | “Genuinely different” requires an identified changed dimension; “semantically equivalent” cannot claim one. |
| Strategy Evaluation | Hard-constraint outcomes plus all 15 required evaluation dimensions | Unknown values stay unscored. Eligible status requires every hard constraint to pass. A ranking score requires an explicit score-policy version. |
| Decision Trace | Context/hash, alternatives, differences, evaluations, result, uncertainty, confidence provenance, policy/evaluator versions, optional model-output hash, plan revisions, and dispatch reference | Trace and context IDs are content-bound. `SELECTED`, `NO_DECISION`, and `BLOCKED` are distinct; selection requires a matching eligible evaluation. No model score overrides the hard constraints. |
| Outcome Evaluation | Decision, Mission, Goal, Execution, Attempt, plan revision, Acceptance/effect identities, observed effect codes, evidence, and World State revision | `ACHIEVED` requires Acceptance, effect-bundle, and supporting-evidence identities; `NOT_ACHIEVED` requires contradicting evidence. The schema does not create an Acceptance or materialize World State. |

## Epistemic and evidence rules

- Facts/evidence are explicitly classified as `OBSERVED`, `SERVER_DERIVED`, `HISTORICAL`, `PREDICTED`, `HYPOTHETICAL`, or `UNKNOWN`.
- Stale, unknown-freshness, predicted, hypothetical, unknown, cross-project, cross-Mission, or unrelated-attempt references cannot be marked eligible proof.
- Root-cause hypotheses are represented only as hypotheses, with separate supporting and contradicting evidence and unresolved questions. A rule-based diagnosis does not become a proven root cause by being serialized.
- Evidence payloads are represented by identity, scope, revisions, confidence metadata, and content hash; the contracts do not embed raw provider output.
- Confidence distinguishes calibrated from heuristic/uncalibrated/unknown values. A calibrated value requires its calibration reference.
- These are shape and identity checks only. Server code must still re-load and verify the referenced durable rows, current attempt, approvals, scope, freshness, and Canonical Proof before acting.

## Relationship to existing strategy infrastructure

The learned `StrategyCandidate` contract and proof-bound replay-case registry remain separate from live Mission recovery decisions. The new alternative can reference an existing candidate, but it does not create another registry or claim that a candidate has passed replay. G3 must adapt the existing Mission strategy engine and candidate/replay infrastructure rather than duplicating them.

## Changes and verification

- Added one shared contract module, its public Agent State exports, and focused schema tests.
- No database table or migration, API route behavior, Mission dispatch, workflow, provider call, or Development/Production data was changed.
- Targeted decision contract tests: **14 passed, 0 failed, 0 skipped**.
- AI-orchestrator package typecheck: **passed**.
- The first typecheck attempt exposed TypeScript inference issues in the new validation callbacks; the contract wrapper and annotations were corrected, and the independent rerun passed.
- `git diff --check` is required again after the final documentation edits.

## Handoff to G3

G3 may now add alternatives and semantic differentiation only for evidence-supported failure families. Before any dispatch integration, it must prove:

1. The alternatives differ in meaningful plan actions/dependencies/validation/recovery behavior, not just names or scores.
2. Missing, stale, cross-scope, contradictory, or insufficient evidence yields a blocked result or `NO_DECISION`.
3. Candidate-registry provenance remains distinct from live Mission evidence and does not bypass replay or approval.
4. Generated strategies remain proposals. Existing Mission authorization, user approval, execution leases, Acceptance, effect observation, and World State transition contracts remain authoritative.
