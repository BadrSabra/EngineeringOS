# EngineeringOS Decision Intelligence — G3 Alternatives

## Gate result

- **G3: COMPLETE as a pure, bounded proposal generator and semantic comparator.**
- **G4: COMPLETE as a separate conservative evaluator; see `docs/engineering-decision-intelligence-g4-evaluation.md`.**
**G5: storage layer verified; live Mission integration remains open.** See `docs/engineering-decision-intelligence-g5-persistence.md`.

The generator is exported from the existing `@workspace/ai-orchestrator` Agent State surface. It is intentionally not invoked by Mission auto-replan, does not change a plan snapshot, and cannot dispatch work. The current `mission-strategy-engine.ts` behavior remains unchanged.

## Supported families

The module accepts only the two Mission recovery families already present in the repository:

1. **Runtime-start recovery:** requires a recovery identity bound to an Acceptance, a fresh eligible World Transition or Observation from the same Mission/Goal/Execution/Attempt, and a matching server-derived failure diagnosis. It proposes two read-only inspection orders: direct runtime status first, or transition provenance first. It does not start, stop, or mutate a runtime.
2. **Validator recovery:** requires a server-derived validator failure, fresh eligible validation evidence tied to the current Execution/Attempt, and a scope summary bound to that evidence. It proposes a targeted repair plan; it adds reconstruct-then-repair only when scope exceeds four paths or spans multiple claims. Mutation proposals retain `approvalRequirement: required` and unknown effect/cost estimates.

Both families compare proposed options against the caller-supplied original plan. Missing, stale, unrelated, or unbound evidence returns a specific blocked result before alternatives are produced.

## Semantic differentiation

The comparator ignores strategy IDs and free-text titles. It compares action/capability order, dependency graph, preconditions, approach category, validation, expected effects, observation/recovery behavior, risk, and approval requirement.

- A difference in action sequence, tool selection, dependency structure, or approach is `GENUINELY_DIFFERENT`.
- Differences limited to validation/effects/recovery/risk/preconditions are `PARTIALLY_DIFFERENT`.
- No change in those semantics is `SEMANTICALLY_EQUIVALENT`.
- If the full alternative set contains no genuinely different pair, generation reports `no_meaningful_alternative_available`; it never chooses a winner.

## Verification

- Decision-contract, generation/differentiation, and existing proof-bound replay tests: **28 passed, 0 failed, 0 skipped**.
- Existing Mission strategy-engine tests: **5 passed, 0 failed, 0 skipped**.
- AI-orchestrator package typecheck: **passed** after removal of the unused import found in the first expanded check.
- Initial test and typecheck failures, their boundaries, and corrections are retained in `docs/engineering-decision-intelligence-g3-test-notes.md`.

No API workflow, database, provider, Mission dispatch, Playwright journey, or live execution was run. These tests prove the pure contract and proposal behavior only.

## Remaining boundary

The new generator is not wired to the live Mission selector, and its scope counts must be derived by trusted server code from current accepted evidence before any future use. G4 consumes proposals under deterministic hard constraints and preserves `NO_DECISION`. G5 now persists and revalidates bounded traces but has no live caller. This gate does not demonstrate that a new strategy improves accepted outcomes.
