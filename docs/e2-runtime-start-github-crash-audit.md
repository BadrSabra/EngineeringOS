# E2 Runtime Start, GitHub Delivery, and Worker-Recovery Audit

## Scope

This audit covers Runtime Start transition acceptance/materialization, verified
GitHub delivery races and process recovery, and the specified worker interruption
boundaries. PostgreSQL-backed checks use a unique temporary cluster bound only to
`127.0.0.1`; they do not use the development or production database.

The existing Mission→Proposal lock coverage remains closed as previously
recorded. E4 and P7.5 remain out of scope. API health is not treated as proof of
Agent Core completion.

## Initial GitHub race-suite result

The first run used an isolated PostgreSQL 17 cluster and applied the current
schema. Four of the five opt-in GitHub delivery race/failure cases passed:

- concurrent admission of a single delivery operation;
- concurrent retries observing an already-delivered commit;
- startup recovery racing an exact retry;
- recovery after the receipt transaction fails.

The remaining case, semantic operation uniqueness, exceeded Vitest's default
20-second timeout and was reported at 23.043 seconds. It produced no failed
assertion or SQL error. This is a test-budget failure, not evidence that the
uniqueness invariant passed or failed. That invariant remains **PARTIAL** until
rerun with a bounded timeout that accommodates this environment.

The command stopped at that failed test, so the process-restart, Runtime Start
startup/crash, and Gate C worker-interruption suites had not run at this point.
No production code or prior lock-audit documents were changed in response to
this timeout.

## GitHub race-suite rerun

After recording the timeout, the semantic-uniqueness case received a
60-second test budget; its assertions and production behavior were unchanged.
The five opt-in GitHub race/failure cases then passed together against a fresh
isolated PostgreSQL cluster. The semantic-uniqueness case completed in 2.17
seconds on this run. This closes those five cases for the exercised
interleavings; it does not establish every GitHub schedule or prove Mission
acceptance by itself.

At that stage, process-restart and Runtime Start interruption checks were
pending; their later outcomes are recorded below.

## GitHub process-recovery first attempt

The process test reached the intended interruption point: the fake remote
acknowledged one ref update, the delivery worker was SIGKILLed before its
post-push read completed, and the database had one attempt with no `GitPushed`
receipt. It then timed out after the test helper's 30-second wait for the
separate full-index `src/index.ts` import. That child emitted no stdout or
stderr before the timeout.

The test did not reach startup recovery, the exact retry, or final receipt
assertions. This is not evidence that startup recovery or duplicate-delivery
prevention passed or failed; those behaviors remain **PARTIAL**. No production
code was changed in response to this import-wait timeout.

For the rerun, the full-index import wait is now explicitly bounded at
120 seconds (within the test's existing 180-second budget). This changes only
the test harness wait, not the application behavior. The rerun result is
no longer pending: the isolated rerun passed the process-recovery case in
46.684 seconds. It asserted the full-index startup recorded one required
recovery marker without retrying the remote write, then an exact retry
reconciled the existing commit, produced one receipt, and kept remote write
counters at one. This closes that tested interruption path; it does not prove
all GitHub delivery schedules.

## Gate C writer-interruption first attempt

The opt-in Runtime Start recipe reached its Gate C completion interception,
but the test did not observe the database trigger paused inside an
`ai_execution_acceptances` insert within its 30-second `pg_stat_activity`
poll. The test therefore did not perform the intended SIGKILL at that
transaction boundary; its cleanup killed any remaining child. The failure was
reported as a timeout where the test expected its injected-interruption marker.

No conclusion about transaction rollback, acceptance durability, or
post-restart recovery follows from this attempt. Those invariants remain
**PARTIAL**. The cause of the missing observed pause is not yet established,
and no production code was changed in response to that first attempt.

## Gate C writer-interruption rerun

The isolated rerun passed after the test began capturing the child's
diagnostics/backend state and allowing up to 120 seconds for the acceptance
transaction pause. It observed the child paused in the acceptance insert,
SIGKILLed it at that point, and asserted the transaction left the execution
running with no acceptance row, the correctly bound World Transition still
pending, and no Mission successor dispatch. Full API startup then reconciled
the expired lease into a failed `EXECUTION_LEASE_EXPIRED` acceptance while
leaving the transition pending and dispatch absent. The selected case took
187.931 seconds.

This closes the tested pre-commit Gate C interruption and expired-lease
startup path. The separate post-commit/pre-response boundary is represented by
an existing gated PostgreSQL integration in
`task-execution-lifecycle.integration.test.ts`: the real acceptance finalizer
returns, the worker pauses before its HTTP response, the test reads the
committed execution/acceptance/task rows, kills the worker, restarts the API,
and verifies those rows plus one completion event and the recovered GET
response. It is generic task-route coverage, not Runtime Start-specific
transition proof.

The first isolated PostgreSQL run of that gated case timed out after
62.774 seconds in `waitForProcessSignalFile`, before receiving the child's
acceptance signal. The child emitted only Vitest's `RUN v4.1.10` startup line
and no stderr. It did not reach the persisted-row assertions, worker SIGKILL,
API restart, or recovered-response checks. This is an inconclusive harness
  timeout, not evidence that post-commit recovery passed or failed; the boundary
  remained **PARTIAL** after this attempt. The cause was not established, and no
  production code was changed.

After recording that limit, a second isolated run raised the signal wait to
180 seconds and the case budget to 300 seconds. It still timed out in the same
wait after 182.650 seconds; the child remained active but emitted no output
beyond the Vitest startup line and no stderr. It again reached none of the
  acceptance, kill, restart, or recovery assertions. I stopped further Vitest
  retries; at that point the test remained **PARTIAL**, and neither run
  indicated a product failure or success at this boundary. The longer test-only
  budget was removed because it did not establish coverage. The later standalone
  Node result is recorded below.

## Runtime Start full-API startup recovery

The separate Runtime Start transition suite has now passed its full-API startup
recovery case in 70.659 seconds. The test asserted that the persisted
acceptance remained `SUCCEEDED` with `CANONICAL_PROOF_PROVEN`, matched the
transition's execution, attempt, and EffectBundle identities, materialized the
transition, and emitted exactly one D2 dispatch. This closes that specific
startup recovery path. The distinct pre-commit Gate C interruption and
transition-materialization rollback results are recorded separately above and
below; they are not inferred from this startup recovery case.

The same isolated PostgreSQL run also passed:

- startup-dispatcher recovery before releasing D2, with one successor dispatch;
- API SIGKILL after acceptance while transition materialization was blocked,
  followed by successful recovery;
- API SIGKILL inside transition materialization, with World State writes rolled
  back;
- due projection failure and transient projection recovery without changing
  Gate C acceptance;
- concurrent `runtime.start` claims dispatching only once;
- exact-transition gating for Mission successor dispatch; and
- resumed GitHub delivery transition rebinding to the new attempt while
  preserving its original direct before-state.

These PostgreSQL cases passed in the recorded run (21 selected tests passed
overall, 45 were skipped by name filter). The GitHub process-recovery and Gate C
writer-interruption first attempts timed out at harness waits, but their
isolated reruns passed the specific assertions recorded above. The generic
task-route response-loss case used a separate standalone harness; its initial
setup failures and eventual successful run are recorded below. That pass does
not establish Runtime Start-specific transition proof.

A standalone Node harness was then run against fresh disposable PostgreSQL
clusters to avoid the large Vitest import graph. In its initial attempts, the
TSX-source API child did not announce readiness within its existing 60-second
bound. Switching to the normal built API artifact reached the real route, but
the request first returned 428 because the fixture lacked an OpenRouter
credential, then 422 with `SCHEMA_VALIDATION_FAILED` after adding a local
provider fixture. These attempts did not reach the response boundary or
acceptance assertions; they were harness setup failures, not product evidence.

## Generic task-route post-commit HTTP response loss

After fixing the fixture response schema, the real API logged a 202 response.
The first response hook did not intercept it; a request-scoped hook then
captured and blocked the response but initially failed its path assertion
because Express had rewritten `req.url` from the incoming `/api/ai/tasks/...`
path to its mounted `/ai/tasks/...` path. Capturing the request path at the
HTTP request event fixed that harness mismatch.

The successful run used the built API against a fresh loopback-only disposable
PostgreSQL database. Before SIGKILL, the test independently read exactly one
completed execution linked to the task, one `SUCCEEDED` acceptance on attempt
0, a completed task, and exactly one completion event. It confirmed the 202
response was blocked before socket write, killed the API worker with SIGKILL,
and observed the client disconnect. A fresh API process then preserved the
same database state, and GET returned 200 with the task completed and the same
successful acceptance identity. The targeted standalone test passed (1/1;
21.6 seconds). Its only failure before the pass was an overly strict GET
assertion that expected no additional public proof/disposition fields.

This closes the generic task-route post-commit response-loss boundary only.
It does not bind a Runtime Start acceptance to a GitHub delivery receipt, and
does not change production behavior or acceptance conditions. The test runs
now set `WORKSPACE_PATH` to a disposable per-run root so startup-generated
files are cleaned with the fixture. An earlier run used the API package root
and caused startup to create the ignored `.local/encryption.key`; its value was
not read or removed.

## Remaining partial boundaries

- The process-recovery test proves one GitHub operation produces one remote ref
  update and one exact receipt; the Runtime Start tests separately prove
  acceptance/transition identity and a resumed delivery-transition rebind.
  No single crash/retry test binds a Runtime Start acceptance through to its
  GitHub receipt, so that end-to-end chain remains **PARTIAL**.
- Gate C was interrupted while its worker held the live execution lease, then
  startup reconciled the expired lease. This does not test an old worker
  continuing to write after another worker takes over; that stale-owner race
  remains **PARTIAL**.
