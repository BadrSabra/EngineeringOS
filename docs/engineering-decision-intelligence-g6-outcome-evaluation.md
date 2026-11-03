# EngineeringOS Decision Intelligence — G6 Outcome Evaluation

## Gate status

- **G6 isolated single-execution evaluator: IMPLEMENTED AND TESTED.**
- **G6 deterministic plan-wide aggregation contract: IMPLEMENTED AND TESTED.**
- **G6 server evidence loader, durable outcome record, and live Mission integration: OPEN.**

Both evaluators are deterministic shared-library functions. The plan-wide aggregator keeps the failed source Goal distinct from successor Goals, binds the dispatch batch and exact Goal/Task/Execution identity sets, requires per-Execution proof references, and requires a separately supplied final World State continuity snapshot. It does **not** query a database, validate caller-supplied rows or hashes, independently reload Canonical Proof, persist an outcome, authorize lifecycle events, or change Mission execution. Its returned evaluation is not proof or authority.

## Forensic integration finding

The existing single-execution contract is not compatible with the live replan trace shape:

- The Decision Trace identity is intentionally bound to the **failed source Goal**. A selected replan materializes successor Goals, and the dispatch batch maps those successor root Goal IDs to persisted Execution IDs.
- The live `DISPATCHED` event for a multi-root plan references the immutable dispatch-batch ID, not one Execution ID.
- The pure evaluator currently requires `execution.goalId === trace.identity.goalId`, `DISPATCHED.referenceId === execution.id`, and one exact eight-event chain with one Execution, Acceptance, and Proof.
- The store explicitly rejects `EXECUTED` immediately after a root-batch `DISPATCHED` event; the batch does not prove that dependent Goals or the complete plan finished.

Therefore, the evaluator's passing synthetic tests do **not** demonstrate that it can evaluate an actual selected replan. Passing a successor Execution directly to the current evaluator is expected to return `INCONCLUSIVE`; weakening the checks or rewriting the source Goal identity would break provenance and is not an acceptable adapter.

## Required plan-wide contract

The live path must evaluate the complete applied plan as one bounded aggregate:

1. Bind the exact `decisionId`, source Goal, selected strategy, current `planRevision`, and `DISPATCHED` batch ID/hash.
2. Reload the complete applied plan Goal set and every relevant Task, Execution/attempt, Acceptance, effect bundle/effect, before/after Observation, current World State revision, and Canonical Proof for that plan.
3. Prove the dispatch batch's exact root Goal→Execution mapping; dependent Goal execution identities must be independently loaded from the same applied revision.
4. Produce per-Goal results and one aggregate verdict. `ACHIEVED` requires complete, current, accepted proof/effect evidence for every required plan Goal. `NOT_ACHIEVED` requires complete terminal evidence and direct contradiction of the selected plan's expected effects. Missing, stale, partial, or conflicting members yield `INCONCLUSIVE`.
5. Persist an append-only, content-hashed outcome snapshot whose identity includes the full Goal/Execution/attempt/Acceptance/Proof set and evidence revision. A changed evidence set must create a distinct evaluation identity; it must not rewrite an earlier result.
6. Only a store transaction that revalidates that entire manifest may append plan-level `EXECUTED`, `ACCEPTED`, `VERIFIED`, and `EVALUATED_AFTER_EXECUTION` references. A dispatch-batch pointer or provider response is never an outcome or proof.

The plan-wide shape now exists as a pure aggregation contract. Until a server loader independently reloads and validates every input from PostgreSQL and an atomic store path persists/revalidates the resulting manifest, neither evaluator may be wired to live Mission replan traces.

## Outcome policy

The isolated single-execution evaluator accepts a validated decision trace, persisted lifecycle references, a server-resolved execution/acceptance/effect bundle, direct effects and observations, the current World State revision, and a Canonical Proof projection that a future API adapter must independently reload and verify.

The new plan-wide aggregator is stricter at the aggregate boundary:

- Its input must be constructed from server-reloaded current plan state; its schema validates shape and exact cross-set bindings, not database truth.
- The source Goal remains the failed Goal in the Decision Trace; successor Goals remain separate IDs under the applied revision.
- A root dispatch batch maps only roots. It is not accepted as completion for dependent Goals or Tasks.
- `ACHIEVED` and `NOT_ACHIEVED` require terminal plan scope, exact dispatch mapping, a current verified final World State snapshot, and complete selected expected-effect evidence. All other cases are `INCONCLUSIVE`.
- The content hash excludes evaluation time but binds the raw input evidence hash, preserving retry idempotency while making changed evidence a distinct snapshot candidate.
- `INCONCLUSIVE` can retain partial/mismatched rows for diagnosis but can never satisfy terminal success/failure constraints or advance the lifecycle.

- `ACHIEVED` requires the exact selected decision and lifecycle chain, same project/Mission/Goal and dispatched Execution, same acceptance attempt and effect bundle, complete acceptance evidence, exact bundle membership, every selected expected effect code observed, complete/fresh before-and-after observations, after-observations tied to the current World State revision, and a bound Canonical Proof whose verified outcome is `ACHIEVED`.
- `NOT_ACHIEVED` requires the same identity bindings, an explicit canonical failure/incomplete acceptance, complete direct observations that contradict every selected expected effect, and current effect-bundle scope. The existing Canonical Proof contract represents accepted objective proof, not a proof of failure; the evaluator does not fabricate one.
- Every missing, stale, partial, conflicting, malformed, or cross-attempt/cross-execution input yields `INCONCLUSIVE`.

Expected effect codes are extracted only from explicit string values or object `effectCode`/`code` fields. Arbitrary IDs are not treated as semantic effect codes. Effect bundle membership compares complete multisets, including duplicate IDs/hashes.

## Verification

See `docs/engineering-decision-intelligence-g6-test-notes.md`. The current focused single- and plan-outcome test file passes **15/15**, and AI-orchestrator typecheck passes. The previously recorded 45-test G2–G4/G6 suite was not rerun after this plan-aggregation addition.

## Required work before closing G6

1. Implement a server-only loader that retrieves the exact trace and validates stored lifecycle event hashes/sequences through the G5 store.
2. Reload current active-plan Goals, Tasks, Executions/attempts, Acceptances, effects, observations, and final World State from PostgreSQL under the established lock order; validate exact identities and revisions.
3. Reload Canonical Proof independently for each required Execution. Do not construct proof status from acceptance or event references alone; do not choose "latest Execution" heuristically when an exact acceptance binding is missing.
4. Persist immutable, content-hashed plan outcome snapshots. A changed evidence set creates a new row; a retry with identical evidence is idempotent.
5. Extend the store so only one transaction that revalidates the full manifest may advance lifecycle events; preserve the current guard that a root-only dispatch batch cannot stand in for plan completion.
6. Add isolated PostgreSQL race, idempotency, stale-input, incomplete-plan, cross-attempt, and mismatch tests; then prove the read-only evaluator cannot schedule or mutate a Mission.

No live Mission outcome has yet been evaluated, and no benchmark improvement can be inferred from these synthetic fixtures.
