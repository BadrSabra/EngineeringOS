# G3 Test Failure Record

## Initial run

The first G3 generation/differentiation test run produced **2 failures and 15 passes**; the package typecheck passed.

1. The runtime safety assertion included the unchanged original-plan baseline in the set of generated proposals. That baseline can contain a mutation. The intended invariant applies to the newly generated runtime inspection alternatives, which must remain read-only. The failure did not establish that the generated proposals were mutating.
2. The dependency-graph assertion expected a difference after reversing the action array and renaming the same sequential edges. Once normalized by action position, both graphs still represented the same sequential dependency. The comparison correctly did not report an additional dependency-structure change; the test fixture had not changed the graph.

These failures are test-scope/fixture errors, not evidence of runtime or lifecycle behavior. No API, database, workflow, provider, dispatch, or execution was run during this test.

## Second run after strengthening the G2 contract

After requiring every proposed action to be covered by the strategy's declared capability set, **1 additional test failed and 16 passed**; typecheck still passed. The semantic-comparison fixture replaced the baseline actions but retained only the baseline capability, so the stricter contract rejected the inconsistent fixture before comparison. This is a contract-fixture mismatch, not a generator/runtime failure. The fixture must declare the capabilities for its replacement actions before that comparison can be tested.

## Final focused verification

After correcting the fixture, the focused AI-orchestrator tests passed **28/28** across the decision contract, proposal generator/differentiator, and existing proof-bound strategy replay suite. The existing Mission strategy-engine test passed **5/5**. The package typecheck first reported one unused import left after removing a helper wrapper; after removing that import, the independent package typecheck passed. No failing check remains from these attempts.

## G4 evaluator first typecheck

The first typecheck after adding the G4 evaluator reported **9 TypeScript errors** in the new module, while the existing focused test set remained **28/28 passing**. The errors were bounded to: using non-existent names for the context's source-execution/source-attempt identity and evidence attempt field, using an effect-class label not present in the contract enum, and nullable accumulator inference in two normalized-coverage calculations. No API server, database, or runtime was started. These are implementation defects in the new evaluator and are to be corrected before G4 is considered complete.

## G4 evaluator first test run

After the type errors were corrected, package typecheck passed. The new combined test run had **33 passes and 1 failure**. The approval-gate fixture renamed an action step to `write` but left its dependency edge pointing at the old `inspect` ID. The contract correctly rejected the inconsistent plan before the approval check ran. This is fixture setup, not an approval-policy failure; the fixture must update its dependency identity.

After correcting that fixture, and adding approval-binding and measured-cost invariants, the final focused suite passed **37/37** tests across the G2 contracts, G3 generation/differentiation, G4 evaluation, and existing proof-bound replay tests. The AI-orchestrator package typecheck passed. No live Mission dispatch, API journey, database write, provider request, or browser test was performed.
