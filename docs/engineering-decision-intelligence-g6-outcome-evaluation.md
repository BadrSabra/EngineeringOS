# EngineeringOS Decision Intelligence — G6 Outcome Evaluation

## Gate status

- **G6 isolated single-execution evaluator: IMPLEMENTED AND TESTED.**
- **G6 deterministic plan-wide aggregation contract: IMPLEMENTED AND TESTED.**
- **G6 server evidence loader and outcome finalizer: PARTIAL; only the fail-closed INCONCLUSIVE path is integration-tested.**
- **G6 additive outcome-snapshot schema: DEFINED; applied only to a disposable test database, not Development.**

Both evaluators are deterministic shared-library functions. The plan-wide aggregator keeps the failed source Goal distinct from successor Goals, binds the dispatch batch and exact Goal/Task/Execution identity sets, requires per-Execution proof references, and requires a separately supplied final World State continuity snapshot. The server-only `evaluateAndPersistMissionPlanOutcome()` reloads and validates the current plan, lifecycle, batch, exact executions/attempts, acceptances, Canonical Proofs, effect bundles, direct before/after observations, and bounded World State within a serializable transaction. Its snapshot ID binds both the evidence-set hash and the complete stable evaluation payload, excluding only `evaluatedAt`; retries preserve the first persisted evaluation. `finalizeMissionPlanOutcome()` re-evaluates and persists in one serializable transaction, then appends the four plan-level lifecycle events only for `ACHIEVED`. `INCONCLUSIVE` and `NOT_ACHIEVED` never advance that lifecycle. The current database integration fixture proves the fail-closed `INCONCLUSIVE` path and idempotent replay, not successful or contradicted terminal outcomes.

## Forensic integration finding

The persisted-effect adapter now reclassifies stored effect contracts using fresh, complete, direct before/after observations. A contradiction is projected to plan-level `NOT_ACHIEVED` only when a terminal failed Acceptance matches the Execution and a current World State contradiction cites the same after-observation. This path remains unverified end to end: the integration suite still lacks durable-row fixtures for both achieved and contradicted outcomes.

The existing single-execution contract is not compatible with the live replan trace shape:

- The Decision Trace identity is intentionally bound to the **failed source Goal**. A selected replan materializes successor Goals, and the dispatch batch maps those successor root Goal IDs to persisted Execution IDs.
- The live `DISPATCHED` event for a multi-root plan references the immutable dispatch-batch ID, not one Execution ID.
- The canonical Trace is persisted before application/dispatch and its hash covers its initial lifecycle only. Later `PLAN_APPLIED` and `DISPATCHED` references are durably appended to the event table; they are not written back into the hashed Trace.
- The first plan-aggregator adapter attempted to merge those later events into a modified Trace. Its isolated test failed with `decision trace ID does not match its contents` (7 other tests passed). The fix keeps the Trace canonical and validates that persisted events match its initial prefix plus the exact plan and dispatch references.
- The older single-Execution evaluator still requires one source-Goal execution and its own exact lifecycle/acceptance/proof chain; it remains unsuitable for successor-plan aggregation.
- The store explicitly rejects `EXECUTED` immediately after a root-batch `DISPATCHED` event; the batch does not prove that dependent Goals or the complete plan finished.

Therefore, the evaluator's passing synthetic tests do **not** demonstrate that it can evaluate an actual selected replan. Passing a successor Execution directly to the current evaluator is expected to return `INCONCLUSIVE`; weakening the checks or rewriting the source Goal identity would break provenance and is not an acceptable adapter.

## Required plan-wide contract

The live path must evaluate the complete applied plan as one bounded aggregate:

1. Bind the exact `decisionId`, source Goal, selected strategy, current `planRevision`, and `DISPATCHED` batch ID/hash.
2. Reload the complete applied plan Goal set and every relevant Task, Execution/attempt, Acceptance, effect bundle/effect, before/after Observation, current World State revision, and Canonical Proof for that plan.
3. Prove the dispatch batch's exact root Goal→Execution mapping; dependent Goal execution identities must be independently loaded from the same applied revision.
4. Produce per-Goal results and one aggregate verdict. `ACHIEVED` requires complete, current, accepted proof/effect evidence for every required plan Goal. `NOT_ACHIEVED` requires complete terminal evidence and direct contradiction of the selected plan's expected effects. Missing, stale, partial, or conflicting members yield `INCONCLUSIVE`.
5. Persist an append-only, content-hashed outcome snapshot whose identity includes the full Goal/Execution/attempt/Acceptance/Proof set and evidence revision. A changed evidence set must create a distinct evaluation identity; it must not rewrite an earlier result.
6. Only a store transaction that reloads the durable evidence and binds the resulting snapshot may append plan-level `EXECUTED`, `ACCEPTED`, `VERIFIED`, and `EVALUATED_AFTER_EXECUTION` references. A dispatch-batch pointer or provider response is never an outcome or proof.

The plan-level finalizer can append a content-addressed `ACHIEVED` suffix and the trace reader validates that suffix against the persisted snapshot, decision, plan revision, dispatch batch, and manifest. However, the `ACHIEVED` writer/suffix path has no successful durable-row fixture, the `NOT_ACHIEVED` evidence path is still intentionally unsupported, and no job/reconciler invokes finalization after plan completion. G6 is therefore still not an operational end-to-end path; the snapshot schema has not been applied to Development.

## Outcome policy

The isolated single-execution evaluator accepts a validated decision trace, persisted lifecycle references, a server-resolved execution/acceptance/effect bundle, direct effects and observations, the current World State revision, and a Canonical Proof projection that a future API adapter must independently reload and verify.

The new plan-wide aggregator is stricter at the aggregate boundary:

- Its input must be constructed from server-reloaded current plan state; its schema validates shape and exact cross-set bindings, not database truth.
- The source Goal remains the failed Goal in the Decision Trace; successor Goals remain separate IDs under the applied revision.
- A root dispatch batch maps only roots. It is not accepted as completion for dependent Goals or Tasks.
- `ACHIEVED` and `NOT_ACHIEVED` require terminal plan scope, exact dispatch mapping, a current verified final World State snapshot, and complete selected expected-effect evidence. The current server loader emits `ACHIEVED` only for fully reloaded accepted proof plus an observed effect bundle and fresh direct observations. The existing `effect-observer` can persist a `CONTRADICTED` bundle, but the G6 loader currently accepts only the `OBSERVED` path and emits no contradicted effect codes or World State binding. It deliberately does not infer `NOT_ACHIEVED` from missing evidence; until that cross-bound adapter is implemented, the outcome remains `INCONCLUSIVE`.
- The content hash excludes evaluation time but binds the raw input evidence hash, preserving retry idempotency while making changed evidence a distinct snapshot candidate.
- `INCONCLUSIVE` can retain partial/mismatched rows for diagnosis but can never satisfy terminal success/failure constraints or advance the lifecycle.

- `ACHIEVED` requires the exact selected decision and durable lifecycle chain, same project/Mission/source Goal and dispatched plan, same acceptance attempt and effect bundle, complete acceptance evidence, exact bundle membership, every selected expected effect code observed, complete/fresh before-and-after observations, after-observations tied to the current World State revision, and a bound Canonical Proof whose verified outcome is `ACHIEVED`.
- `NOT_ACHIEVED` requires the same identity bindings, an explicit canonical failure/incomplete acceptance, complete direct observations that contradict every selected expected effect, and current effect-bundle scope. The existing Canonical Proof contract represents accepted objective proof, not a proof of failure; the evaluator does not fabricate one.
- Every missing, stale, partial, conflicting, malformed, or cross-attempt/cross-execution input yields `INCONCLUSIVE`.

Expected effect codes are extracted only from explicit string values or object `effectCode`/`code` fields. Arbitrary IDs are not treated as semantic effect codes. Effect bundle membership compares complete multisets, including duplicate IDs/hashes.

## Verification

See `docs/engineering-decision-intelligence-g6-test-notes.md`. The focused evaluator suite passes **15/15**, API-server typecheck passes, and the isolated Mission Trace integration file passes **8/8** on a fresh loopback-only temporary PostgreSQL cluster. The test proves that an incomplete/`INCONCLUSIVE` finalization does not advance lifecycle and that a repeated evaluation reuses the same content-addressed snapshot. No `ACHIEVED` or `NOT_ACHIEVED` server-writer path and no live Mission has been evaluated.

## Required work before closing G6

1. Add isolated server-writer fixtures for a fully `ACHIEVED` plan, current-world mismatch, stale observations, cross-attempt/cross-execution identities, and actual contradicted evidence. Keep the current fail-closed behavior until each case is bound to durable rows.
2. Review the additive snapshot-table diff against Development before applying it. Only the disposable test database has received the Drizzle schema so far.
3. Add a durable reconciliation trigger after all current-plan Goals and Tasks are terminal, with lease ownership and idempotency; it must not rerun already completed side effects.
4. Add success-path and tampered-snapshot tests for lifecycle suffix creation and read-time binding. A dispatch-batch pointer remains provenance, never completion or proof.
5. Add database-level immutability enforcement for outcome snapshots, or explicitly retain and monitor the weaker application-only insert contract.
6. G7 shadow-only comparisons, followed by G8 recovery/safety tests; G9/G10 remain blocked on measured accepted outcomes and held-out transfer evidence.

No live Mission outcome has been evaluated. The snapshot has been written only in the disposable integration database; Development and Production were not modified. No benchmark improvement can be inferred from the synthetic and incomplete-evidence fixtures.
