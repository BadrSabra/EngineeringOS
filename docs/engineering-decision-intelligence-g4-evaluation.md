# EngineeringOS Decision Intelligence — G4 Evaluation

## Gate result

- **G4: COMPLETE as a deterministic, pure evaluator and selector.**
**G5: STORAGE LAYER VERIFIED; LIVE INTEGRATION OPEN.** See `docs/engineering-decision-intelligence-g5-persistence.md`. The current Mission selector and dispatcher do not yet call the trace store.

The evaluator returns per-strategy hard constraints, all 15 contracted dimensions, pairwise Pareto relations, and one of `SELECTED`, `NO_DECISION`, or `BLOCKED`. A `SELECTED` result is a recommendation only; it is not approval, execution, acceptance, verification, or mutation authority.

## Policy

### 1. Hard constraints precede ranking

Before comparison, each alternative is checked for:

- Server authorization and exact objective-code match.
- Approval state; a granted approval must bind the same strategy ID, canonical strategy hash, and prior plan revision.
- Required capabilities: unavailable means rejected, unknown means unknown, and neither can be promoted by a score.
- Fresh, eligible, correctly scoped evidence for each required evidence kind.
- Evidence-bound preconditions and an explicit match to the current World State revision.
- Known action effect class, risk band, reversibility, and a validation procedure.
- Current evidence binding for recovery diagnoses, required observations, unresolved questions, and contradictions.
- Candidate-registry alternatives remain ineligible/unknown until a current replay gate is proven.

Any rejected constraint makes a strategy ineligible. Any unknown hard constraint prevents selection. High-risk strategies are rejected under this conservative policy; unknown risk remains unknown.

### 2. No weighted scalar score

The evaluator intentionally leaves `rankingScore` null and uses **unweighted Pareto dominance**. There is no evidence-based justification in the current baseline for fixed weights, and a single weighted score could let a strong predicted-success score hide a safety or provenance failure.

All normalized dimensions use “higher is preferable”:

- Exact objective match: 1; mismatch: 0 (mismatch is also a hard rejection).
- Evidence/precondition/capability coverage: satisfied items divided by required items, only from current eligible evidence or server capability declarations.
- Failure risk: low 1, medium 0.5, high 0. The numbers encode ordinal bands, **not probabilities**; high risk is separately rejected.
- Reversibility: reversible 1, partial 0.5, irreversible 0.
- Side-effect safety: read-only 1, reversible mutation 0.5, irreversible/external effect 0; unknown action effect stays unknown.
- Human intervention: no approval required or already bound to the exact proposal: 1; a pending approval never passes the hard gate.
- Validation strength: 1 when at least one validation procedure is declared, otherwise 0; this measures presence only, not validator quality.
- Recovery complexity: cohort-relative min-max score from action count plus dependency-edge count; lower structure count receives a higher score.
- Cost and duration: cohort-relative min-max score, only when every eligible candidate has a same-unit measured estimate bound to current eligible evidence. Otherwise all such candidate values remain unknown.
- Expected success probability and information gain remain unknown until suitable calibrated outcome evidence exists.
- World State compatibility is 1/0 only when an explicit current-revision precondition is evidence-bound; otherwise unknown.

No default zero, synthetic probability, ID-based tie-break, or model-provided rank is used for missing values. A candidate must have complete critical dimensions. Selection requires either the sole eligible candidate with no unknown competitor, or one unique candidate that Pareto-dominates every other eligible candidate. Equal or incomparable candidates, and any potentially relevant unknown alternative, yield `NO_DECISION`.

## Verification

- G2 contract, G3 generation/differentiation, G4 evaluation, and existing proof-bound replay suites: **38 passed, 0 failed, 0 skipped**.
- AI-orchestrator package typecheck: **passed**.
- The prior Mission strategy-engine test passed 5/5 before the G4 module was added. It must be rerun with the final shared-package changes before a later integration gate.
- Test failures and their bounded causes are recorded in `docs/engineering-decision-intelligence-g3-test-notes.md`.

No provider, API workflow, database, browser, Mission dispatch, or execution was run. G4 does not claim product-level improvement.

## Boundary for G5 and G6

G5 now persists content-hashed decision traces and idempotent lifecycle events, including `PLAN_APPLIED` before dispatch. It is application-level insert/append-only, not protected from direct SQL modification, and not yet connected to the live Mission flow. Database records do not grant authority; any future consumer must reload and revalidate the same current Mission, Goal, Execution/Attempt, plan/project revision, approval, and evidence identities. G6 has a pure evaluator that conservatively compares expected effects with proof-bound outcomes; its server evidence loader and persistence are still open.
