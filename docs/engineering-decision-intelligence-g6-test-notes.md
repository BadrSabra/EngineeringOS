# EngineeringOS Decision Intelligence — G6 Test Notes

## Initial outcome-evaluator fixture failure

The first G6 focused run reported **5 failed, 38 passed** across the focused set. All five new outcome-evaluation tests failed while parsing their shared strategy fixture: it used `validator_recovery`, which is not a supported `MissionStrategyAlternative.category`. The evaluator itself was not reached, so this failure provides no evidence about outcome-classification behavior. The pre-existing G2–G4 contract/generation/evaluation/replay tests remained **38/38 passing**, and AI-orchestrator typecheck passed. The fixture is being corrected to use a category defined by the current contract before rerunning.

## Rerun after fixture correction and safety tightening

After replacing the unsupported category with `verify_then_retry`, tightening effect-code extraction to explicit `effectCode`/`code` fields, allowing before observations to precede the final World State revision while requiring after observations to match it, and adding malformed-evidence coverage:

- AI-orchestrator typecheck: **passed**.
- G6 outcome evaluator and G2–G4 focused suites: **45 passed, 0 failed** (7 G6 tests plus 38 existing tests).
- The tests cover exact lifecycle and acceptance identity, direct fresh before/after effects, current after-state revision, proof binding, cross-attempt and cross-execution rejection, incomplete evidence, explicit contradictions, conflicting success/failure evidence, and malformed effect evidence returning `INCONCLUSIVE`.

These are pure evaluator tests. They do not prove a database adapter exists, that a canonical proof is independently reloaded for this evaluator, that an outcome record is persisted, or that the live Mission flow invokes it.

## Final whitespace check

`git diff --check` initially reported trailing spaces on five newly edited Markdown status lines used for visual line breaks. This was documentation formatting only; it did not affect code or tests. The spaces were removed before the final diff check.

The expanded whitespace scan, which also covers untracked files, found Markdown hard-break spaces in several newly added gate documents that the ordinary tracked-only `git diff --check` did not inspect. This is documentation formatting only; those lines are being converted to explicit paragraph/bullet formatting before the final scan.

## Plan-wide aggregation contract

The single-Execution evaluator was not widened to accept a successor Goal. Instead, a separate deterministic aggregator now accepts a server-resolved active plan projection and keeps the failed source Goal separate from successor Goals. It requires exact Goal/Task/Execution mappings, current plan and root dispatch references, per-Execution acceptance/effect/Canonical Proof references, and an independently verified final World State snapshot before `ACHIEVED` or `NOT_ACHIEVED`. Its content hash binds stable evidence while excluding evaluation time.

Latest verification:

- `pnpm --filter @workspace/ai-orchestrator exec vitest run src/agent-state/mission-strategy-outcome-evaluation.test.ts`: **15 passed, 0 failed**.
- `pnpm --filter @workspace/ai-orchestrator run typecheck`: **passed**.
- Cases include source-vs-successor Goal identity, partial Task state, unverified final World State, missing proof bindings, root-dispatch mismatch, persisted lifecycle-reference mismatch, achieved plan aggregation, and fully contradicted terminal outcome.

These tests remain synthetic. The aggregator does not load PostgreSQL, recalculate stored dispatch manifests, independently reload Canonical Proof, write an outcome record, or append lifecycle events. The live `EXECUTED` guard remains unchanged and must not be bypassed.
