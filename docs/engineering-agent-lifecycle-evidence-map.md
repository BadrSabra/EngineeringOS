# Engineering Agent lifecycle and delivery-gate evidence map

This note records the source-first audit and baseline before implementation
changes for `EngineeringOS-Lifecycle-Continuity-Delivery-Gates-PR`.

## Source map

| Source | Observed behavior | Existing test/evidence | Gap |
|---|---|---|---|
| `artifacts/api-server/src/routes/ai/missions.ts:buildEngineeringAgentProjection` | Loads the active Mission/Goal/Execution, current-attempt acceptance, and Canonical Proof before building the Agent projection and `workspaceSummary`. Completed Mission state is re-evaluated through `projectMissionCompletion`. | `missions.test.ts` projection and owner-isolation cases; `AiChat.authenticated.test.tsx` verifies the rendered summary. | Failed acceptance currently falls through to summary evidence `pending`; no focused summary contract tests distinguish failure, policy skip, and unreconciled outcomes. |
| `artifacts/api-server/src/lib/engineering-agent-projection.ts:createEngineeringAgentWorkspaceSummary` | Counts completed and proven Goals separately. The `proven` state requires a completed current Execution, successful current acceptance, and accepted proof bound to that Execution. | `engineering-agent-projection.test.ts` covers accepted proof and completed-but-unproven state. | Add the missing failure, not-run, policy-skipped, and unknown projection cases; keep the summary display-only. |
| `artifacts/api-server/src/lib/engineering-agent-action.ts:selectEngineeringAgentAction` and `dispatchEngineeringAgentAction` | Requires an exact current decision before selecting a server-owned action; dispatch uses an exhaustive handler map. The route reserves/replays through the shared action ledger. | `missions.test.ts` gateway tests cover action branches, stale decisions, same-key replay, and concurrent reservation. The isolated Mission Control runner passed its selected gateway tests in the baseline. | Reuse this gateway; no competing lifecycle or idempotency scheme is warranted. |
| `artifacts/api-server/src/lib/mission-completion-gate.ts:evaluateMissionCompletion` | Locks the Mission and Goals, selects the active-plan Goals, reloads Canonical Proof, and checks Goal dependencies before allowing completion. | `mission-runtime.test.ts` covers missing acceptance, incomplete evidence, stale World State, attempt rotation, and plan-revision rotation. `proof-foundation.test.ts` covers required delivery and delivery identity mismatch. | Add production-gate cases for required versus optional delivery and terminal/unknown delivery evidence; do not duplicate the decision algorithm in tests. |
| `artifacts/api-server/src/lib/proof-foundation.ts:composeCanonicalProof` / `loadCanonicalProof` | Completion proof is composed from durable current-attempt execution, acceptance, evidence, scope, and the execution's durable delivery receipt; caller-projected delivery data cannot override it. | `proof-foundation.test.ts` covers required delivery and rejects a forged caller receipt when the durable receipt is pending. | Preserve this proof boundary when adding completion cases. |
| `artifacts/api-server/src/lib/github-delivery-service.ts:executeVerifiedGitHubDelivery` and `artifacts/api-server/src/lib/job-reconciliation.ts:reconcileInterruptedGitHubDeliveryAttempts` | Records a delivery attempt before remote mutation and marks an attempt without an exact receipt for reconciliation instead of blindly replaying it. | `github-delivery-races.integration.test.ts` includes concurrent and failed-receipt-finalization recovery cases. These are opt-in with `RUN_E2_GITHUB_DELIVERY_RACES=1` and are not run by the standard Mission Control runner. | Execute the existing failure-injection suite through the disposable PostgreSQL harness and assert the side effect is not duplicated. |
| `artifacts/dashboard/e2e/dashboard.journey.ts:engineering-agent-lifecycle` and `scripts/run-goal-first-e2e.mjs` | The controlled lifecycle test uses a loopback-only disposable PostgreSQL cluster, a local bare remote, and a provider fixture; it writes a receipt and performs offline verification only after a passing journey. | Baseline command: `pnpm run validate:engineering-agent-lifecycle-e2e`. | The flow has a source Mission and a distinct Apply Mission linked through the proposal. It proves that relationship, not one identical `missionId` across all stages; reconcile this with I1 before claiming the single-Mission criterion. |
| `scripts/verify-engineering-agent-lifecycle-receipt.mjs:validateReceipt` / `verifyOfflineReceipt` | Validates receipt shape and source fingerprint; offline verification does not need to reconstruct evidence. | The baseline receipt-contract suite passed 17 tests. | The baseline journey produced a blocked receipt, so offline verification of a successful lifecycle receipt remains unproven in this run. |

## Baseline failure and limits

No source code was changed before this baseline. The command
`env -u GOAL_FIRST_LIVE_PROVIDER -u ENGINEERING_AGENT_LIFECYCLE_RUN_ID -u ENGINEERING_AGENT_LIFECYCLE_STARTED_AT pnpm run validate:engineering-agent-lifecycle-e2e`
used the isolated fixture path, not a live provider, shared database, or remote
repository.

The end-to-end path reached the final browser-cleanliness assertion after the
Apply Mission reported `COMPLETE`, the local and bare-remote commit matched,
and the durable Mission/Chat reload assertions ran. The run was correctly
reported as **blocked**, not passed: `browserErrors.assertClean()` found a Clerk
component-renderer error and two `Loading chunk 6666 failed` page errors on
`/dashboard/missions`. The captured network trace showed no failed JavaScript
resource response; its observed HTTP errors were `GET /scorecard` 404s, so the
chunk-error cause is not yet established.

The run's receipt is retained under `release-evidence/engineering-agent-lifecycle/`
with `status: blocked` and `stage: durable-reload`. That stage reflects where
the test was when the final browser assertion failed; it is not a successful
receipt. The runner stopped its disposable PostgreSQL cluster and reported no
services surviving teardown. The raw Playwright trace was removed after
inspection because authenticated traces can contain session material; the
sanitized error context and blocked receipt remain.

An unchanged rerun then passed with exit code 0 and the same source fingerprint.
The lifecycle assertions and offline verification passed for
`release-evidence/engineering-agent-lifecycle/0a7095ad-8e9e-4956-984c-2a18060a399b.json`.
This confirms the initial browser error was intermittent in the controlled
environment; it was not suppressed or treated as a pass.

The lifecycle receipt contains distinct source and Apply Mission identities
connected by the approved proposal handoff. This is real continuity evidence
for the current product flow, but it does not establish the stricter I1 claim
that a single Mission ID spans both parts of the flow.

## Test-first findings before implementation

The first new summary regression test failed at its initial assertion:
`summary.currentGoal` was `null` for a failed Goal. Because that assertion ran
before the evidence-state assertion, this run did not yet measure the evidence
state. The source branch independently shows non-successful acceptances map to
`pending`; the next test run will assert that specific state without assuming a
failed Goal must be selected as the current actionable Goal.

`node scripts/run-mission-control-tests.mjs` used its loopback-only disposable
PostgreSQL cluster. The existing Mission/Goal completion delivery matrix passed
9 selected cases. Enabling the previously opt-in delivery race suite reproduced
4 failures out of 5 cases: the insert-barrier case timed out waiting for
`GitPushAttemptStarted`, concurrent exact retries returned `blocked` instead
of `passed`, and the startup-recovery and failed-receipt-finalization cases
timed out at 20 seconds. The suite uses a fake GitHub request adapter and a
local fixture; no external repository was contacted. The runner stopped and
removed its disposable cluster after the failure. No production-code fix has
been made for these findings yet.

Source inspection narrowed the race-suite failure to its fixture: the local
fixture commit message is `verified local delivery`, while the production
service rejects a commit unless its message contains the operation marker
`EngineeringOS-Operation: <operationId>`. The blocked results therefore occur
before the attempt-insert barrier or remote mutation; these failures do not yet
demonstrate a production race. The fixture should be corrected, then the same
isolated suite rerun before making any claim about the delivery race contract.

After correcting that fixture marker, `node scripts/run-mission-control-tests.mjs`
passed with exit code 0. It passed the 21 selected Mission/action route cases,
all 9 selected completion-delivery cases, all 5 delivery race cases, and the
remaining replan, control-route, telemetry, and provider-mocked groups. The
added UI regression failed as expected: a policy-exempt `unavailable` summary
rendered “تعذر التحقق من الأدلة” instead of a policy-skip label. The projection
regression also reproduced the separate failure-state defect: a terminally
failed attempt was projected as `pending` with no reason code.

The first reducer change routed every failed Goal to `REPLAN`. An existing
regression test rejected that behavior for failures without an explicit retry
or resume disposition: those must remain non-mutating `REVIEW` decisions.
This confirms that surfacing failure must not grant recovery authority. The
final reducer change will preserve explicit retry precedence and use `REVIEW`
for other failed Goals.

The next focused run caught one ordering issue in that adjustment: an unrelated
failed Goal could preempt an earlier plan-ordered Goal already marked
`needs_replan`. The existing plan-order test failed with `REVIEW` targeting the
later Goal instead of `REPLAN` targeting the first eligible Goal. Preserve
plan-order recovery by evaluating explicit `REPLAN` before the generic
non-retryable failure `REVIEW`.

After the corrected priority order, the pure projection suite passed 20/20,
the authenticated Dashboard test file passed 251/251, the isolated Mission
Control runner passed all selected route, completion, race, replan, telemetry,
and mocked-provider groups, and the full workspace `pnpm run typecheck` passed.
The test-only optional `proofs` assertion was corrected before that typecheck.

The final controlled lifecycle run, after the source changes, passed its
authenticated browser test (1/1). The durable receipt verified the Chat,
Mission, proof, approval, Apply, and local bare-remote commit links; offline
receipt verification also passed for
`release-evidence/engineering-agent-lifecycle/34acaaa0-c540-433f-b66f-2e43a5203143.json`.
No live model inference was run, and nothing was deployed. The first
intermittent browser-error failure remains recorded above; the passing rerun
does not suppress it. The static preview screenshot shows the public
sign-in/landing page, not a signed-in session; authenticated UI behavior was
verified by the browser journey and the Dashboard test suite.

The selected route/action cases in this runner are not proof that each of the
nine gateway action kinds has its own real integration coverage for execution,
failure, and concurrency. That remains a separate verification gap; this
acceptance does not claim all nine branches are proven.
