# Mission / Proposal / World Transition Lock Coverage

**Status date:** 2026-10-19  
**Scope:** Close out the identified lock-test gaps and record direct evidence. This is
not a general concurrency audit and does not change production behavior.

`PROVEN` below means the exact scenario in that row has a direct PostgreSQL
integration test. `PARTIAL` means meaningful evidence exists, but at least one
production route, ordering variant, process boundary, or interleaving has not
been tested directly. A passing test suite does not promote untested paths.

## Mission → Proposal

| Edge / scenario | Production paths and actual lock order | Initial read and revalidation | Direct test and what it establishes | Result |
|---|---|---|---|---|
| Apply Mission handoff vs Proposal mutation while the handoff waits | `POST /api/ai/missions/apply-from-proposal`: unlocked Proposal lookup → lock the project's Missions → lock Proposal → reread Missions without row locks → insert Mission/plan/event. It does not lock a Goal; the handoff creates its Goals inside the transaction. | The initial Proposal row is compared in full with the locked row. Only `approvalRequired: true → false` is tolerated; the locked Proposal must be pending and approval-cleared, with required source/candidate fields valid. The Mission duplicate scan is repeated after the Proposal lock. The handoff pins Proposal revision, base-tree hash, operation ID, candidate identity, and the apply requirement into the new Mission. | `routes/ai/missions.test.ts`, parameterized test `revalidates the complete Proposal identity after the handoff waits on its row lock`: a separate transaction holds the actual PostgreSQL Proposal row lock, the real route is observed waiting, then the blocker either leaves the row unchanged or mutates one of 11 fields (status, approvalRequired, lifecycle, revision, base revision, base-tree hash, candidate-tree hash, change-set hash, changes, operation ID, workspace root). Unchanged state creates one bound Mission; each changed identity is rejected without Goals, Tasks, executions, or correlated events. The revision case also starts two handoffs. | **PROVEN for these 12 parameter cases; PARTIAL for the full route family.** This does not test every writer or every update ordering. |
| Legitimate approval clearing while a handoff is blocked | `approveMissionGoal` locks Mission → Goal → linked Execution → Proposal, validates pending status, required approval, and exact revision, then clears only the approval flag. The handoff uses Mission → Proposal. | Both paths re-read under their locks. The handoff accepts only the explicit `true → false` approval transition; all other Proposal identity changes remain conflicts. | `routes/ai/missions.test.ts`, `does not deadlock proposal handoff against Mission Goal approval locks`: uses the real approval helper and real HTTP handoff route, with a PostgreSQL Execution-row barrier to establish overlap. The approval completes and the handoff returns 201. This exercises the narrow legitimate approval exception, not every possible approval/Proposal mutation schedule. | **PROVEN for the tested interleaving; PARTIAL overall.** In particular, the test establishes the overlap through a Mission wait; it is not a separate test where approval is the sole blocker on the Proposal row. |
| Same-Proposal duplicate handoffs | The same Mission → Proposal order serializes creation for a pending Proposal; the post-Proposal-lock Mission reread detects the winner. | The second request checks for a live Apply Mission after acquiring the Proposal lock. | The existing concurrent route case records exactly one 201 and one 409. It checks the outcome but does not establish every possible cross-process scheduling order. | **PARTIAL.** |
| Late handoff transaction failure | Mission, generated plan/Goals, and correlated event are created in one transaction after the Proposal checks. | The transaction uses the locked Proposal identity; failure before commit should leave no partial Mission handoff. | The route-level failure-injection test in `routes/ai/missions.test.ts` fails a later write and checks rollback of the Mission and generated plan. It is a bounded injected database failure, not a process crash/restart test. | **PROVEN for the injected late-write failure; PARTIAL for crash and recovery windows.** |
| Execution attempt, Acceptance, or Apply receipt changes while creating the handoff | The creation route does not lock or load an Execution, Acceptance, or Apply receipt. Those are not inputs to its initial handoff decision; Proposal identity is pinned, and later Apply/D2 gates validate execution and effect evidence. | No handoff-time revalidation of execution attempt, Acceptance, or receipt is claimed. Do not treat the handoff as having tested those identities. | No direct lock-race test for changing an Execution attempt, Acceptance, or Apply receipt while this route waits. D2 and execution-acceptance tests cover separate lifecycle boundaries. | **PARTIAL / not established by the handoff tests.** |

## World Transition → Episode

| Edge / scenario | Production paths and actual lock order | Initial read and revalidation | Direct test and what it establishes | Result |
|---|---|---|---|---|
| Apply Changes Transition claim vs Episode and D2 | `claimApplyChangesTransition` locks the exact World Transition first, validates project/execution/attempt/Episode/action/effect-bundle identity, then reads Execution and current-attempt Acceptance, then locks the matching Episode and changes the Transition claim state. The Execution and Acceptance reads here are not `FOR UPDATE`. | Claim inputs identify the intended Episode; after the Transition lock, the Episode lock query rechecks Episode ID, project, execution, and attempt. A mismatch terminally rejects the claim. Materialization later rechecks source observations, effect and revision bindings in its own transaction. | `mission-runtime-apply-changes.test.ts`, `serializes a Transition claim against the live D2 gate before atomically materializing Episode`: holds the real Episode row lock, starts the real Transition finalizer, observes PostgreSQL waiters, then starts the D2 transaction and observes it waiting on the Transition. Releasing the Episode lets the worker materialize and the D2 gate reports pending while materialization is in progress; all transactions finish without `40P01`, and the resulting Episode/Transition identities match. | **PROVEN for this Apply Changes claim/D2 interleaving; PARTIAL across all Transition producers and consumers.** |
| Apply Transition claim vs Mission dependency proof | Dependency authorization can inspect the accepted Apply evidence while the Transition claimant advances through Transition/Episode state. | The test's blocker owns the current-attempt Acceptance row; both production operations re-enter their normal gates after release. The Transition is rejected closed on the fixture's Goal/Proposal mismatch rather than treated as successful. | `mission-runtime-apply-changes.test.ts`, `does not deadlock dependency proof against an Apply Changes transition claim`: real PostgreSQL transactions, observed lock wait, no `40P01`, both operations settle, and the Transition becomes `terminal_failed` with the expected mismatch. This is not a successful proof/dispatch test. | **PROVEN for this bounded lock/fail-closed interleaving; PARTIAL for other dependency schedules.** |
| Apply materialization vs acceptance finalization | The Apply materializer claims Transition before Episode; acceptance finalization locks Execution before Acceptance/Episode/effect records. The observed path is not a universal total order across every entity; compatibility depends on which rows each transaction needs. | The transition is tied to the explicit execution/attempt/Episode/action/effect bundle; acceptance finalization revalidates its execution and attempt under its locks. | `runtime-start-transition.test.ts` contains an integration interleaving of `finalizeApplyChangesTransition` and duplicate `finalizeExecutionAcceptance`, using a held EffectBundle row and observed PostgreSQL waiters. It demonstrates two real transactions, not merely synthetic handling of SQLSTATE `40P01`. This case was not part of the latest three-test focused run recorded below. | **PARTIAL.** The source/test establish a bounded interleaving, but this matrix does not record it as freshly rerun with the three latest cases. |
| Failure after the Episode update path begins | Apply materialization writes World State, updates the Episode revision, and materializes the Transition transactionally. On failure, the caller records `terminal_failed` outside the rolled-back materialization transaction. | The failure is injected only after the target Episode's `world_revision` update reaches its database trigger. A non-transactional sequence records that the trigger ran even though the transaction is rolled back. | `mission-runtime-apply-changes.test.ts`, `rolls back World State and Transition writes when the post-Episode update trigger fails`: verifies the Episode revision and stable World State facts/revision are unchanged, and materialization fields remain empty. The durable Transition is `terminal_failed / world_state_materialization_failed`; that failure marker is expected and is not a partially materialized World State. | **PROVEN for this post-Episode-update failure boundary; PARTIAL for process death and other write/crash points.** |
| Other Transition producers and cross-process recovery | `runtime.start` and GitHub delivery use additional claim/finalization paths. They share identity and retry helpers but do not all execute the same Apply Changes transaction. | Each producer has its own execution, attempt, action, and Episode bindings; source inspection alone does not prove the same race behavior. | No direct, edge-specific reproduction is recorded here for every `runtime.start` or GitHub-delivery lock schedule, multiple OS workers, or process-death point. | **PARTIAL.** |

## Recorded verification

On a disposable loopback-only PostgreSQL cluster, the focused Proposal row-lock
case passed all 12 parameter cases. The focused Apply Changes Transition/Episode
suite passed its three direct cases: Transition-vs-D2 serialization,
post-Episode-update rollback, and dependency-proof-vs-Transition claim. API
TypeScript typecheck and `git diff --check` passed. These results verify only the
listed cases, not the untested paths marked `PARTIAL`.

The new rollback test first compared a dynamic `generatedAt` field and failed
that overly broad equality assertion; stable World State identity, revision,
and fact invariants were unchanged. The assertion was narrowed to those stable
invariants, and the test then passed. This was an assertion-stability correction,
not a reproduced partial-World-State failure.

## API operation status (separate from test health)

The API workflow is currently **not started**. During the prior API start
attempt, the workflow reported `EADDRINUSE` on port 8080 while an existing Node
API process was present and responded to a request. Its ownership was not
confirmed, so it was left running and not restarted or terminated. That is an
operational port-ownership issue: it is neither a failure of the lock tests nor
proof that the managed API workflow is healthy.

No `/api/healthz` result was collected as part of the lock-test verification
recorded above. The typecheck and PostgreSQL integration tests are backend
engineering checks, not an API liveness probe. Keep those result categories
separate.

## Explicitly out of scope

This matrix does not assess or close E4, P7.5, learning-measurement readiness,
or independent evaluation-source qualification. Successful lock tests provide
no evidence for those gates.
