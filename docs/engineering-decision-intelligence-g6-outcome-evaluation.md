# EngineeringOS Decision Intelligence — G6 Outcome Evaluation

## Gate status

- **G6 pure evaluator: IMPLEMENTED AND TESTED.**
**G6 server evidence loader, durable outcome record, and live Mission integration: OPEN.**

The evaluator is a deterministic shared-library function. It does not query a database, load acceptance/effect records, verify Canonical Proof, persist an outcome, or change Mission execution. Its returned evaluation is not proof or authority.

## Outcome policy

The evaluator accepts a validated decision trace, persisted lifecycle references, a server-resolved execution/acceptance/effect bundle, direct effects and observations, the current World State revision, and a Canonical Proof projection that a future API adapter must independently reload and verify.

- `ACHIEVED` requires the exact selected decision and lifecycle chain, same project/Mission/Goal and dispatched Execution, same acceptance attempt and effect bundle, complete acceptance evidence, exact bundle membership, every selected expected effect code observed, complete/fresh before-and-after observations, after-observations tied to the current World State revision, and a bound Canonical Proof whose verified outcome is `ACHIEVED`.
- `NOT_ACHIEVED` requires the same identity bindings, an explicit canonical failure/incomplete acceptance, complete direct observations that contradict every selected expected effect, and current effect-bundle scope. The existing Canonical Proof contract represents accepted objective proof, not a proof of failure; the evaluator does not fabricate one.
- Every missing, stale, partial, conflicting, malformed, or cross-attempt/cross-execution input yields `INCONCLUSIVE`.

Expected effect codes are extracted only from explicit string values or object `effectCode`/`code` fields. Arbitrary IDs are not treated as semantic effect codes. Effect bundle membership compares complete multisets, including duplicate IDs/hashes.

## Verification

See `docs/engineering-decision-intelligence-g6-test-notes.md`. AI-orchestrator typecheck passed; the focused evaluator plus G2–G4 contract, generation, evaluation, and replay suites passed **45/45**.

## Required work before closing G6

1. Implement a server-only loader that retrieves the exact trace and validates stored lifecycle event hashes/sequences through the G5 store.
2. Reload the current Execution, Acceptance, effect bundle, effect rows, before/after observation rows, and World State from PostgreSQL under the existing lock order. Validate each identity, attempt, revision, freshness, and effect contract.
3. Invoke the existing Canonical Proof revalidation path; do not construct proof status from acceptance or event references alone.
4. Persist the output as an append-only outcome record bound to the decision, execution, attempt, acceptance, bundle, plan revision, World State revision, and content hash; append the matching `EVALUATED_AFTER_EXECUTION` lifecycle event atomically.
5. Add isolated PostgreSQL race, idempotency, stale-input, and mismatch tests; then wire the read-only evaluator only after proving it cannot schedule or mutate a Mission.

No live Mission outcome has yet been evaluated, and no benchmark improvement can be inferred from these synthetic fixtures.
