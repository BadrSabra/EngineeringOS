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

## Canonical Mission identity map (read-only, before implementation)

The user-level lifecycle uses two distinct Mission rows: the Chat-created
source Mission and the Apply Mission created for the approved proposal. The
source Mission is the logical root; equating those IDs would be incorrect.

| Link | Authoritative source | What it proves today | Remaining identity gap |
|---|---|---|---|
| Chat → canonical Mission | `lib/db/src/schema/ai_chats.ts:12-49` makes `activeMissionId` a nullable FK to `ai_missions`; `ai_mission_handoffs.ts:19-75` stores the durable session/message-to-Mission handoff. `missions.ts:2010-2225` writes the handoff and updates the session pointer. | A server-created Mission can be recovered from its Chat handoff; the session pointer is not itself the handoff record. | No later Apply Mission row directly references this canonical Mission. |
| Mission → Goal → Execution | `ai_missions.ts:45-110` defines Mission and Goal; each Goal has an FK to Mission. `ai_executions.ts:34-109` has `goalId` as an FK to Goal. `mission-runtime.ts:1931-1964,2073-2095` dispatches recipes using the Mission/Goal scope and recovers queued executions by joining Execution → Goal. | Execution ownership can be re-derived through its Goal; the Proof path binds the execution to the Mission whose Goal owns it. | This identifies the Mission for a given Execution, but does not connect an Apply Mission back to the source Mission. |
| Execution → Proposal | `chat.ts:12847-12870` inserts the proposal and stores its ID on the producing Execution. `ai_executions.proposalId` is text, without an FK; the Proposal has session/message provenance but no Mission or Execution column (`ai_change_proposals.ts:47-96`). | The standard Mission-run path persists an Execution-to-Proposal pointer, and candidate acceptance checks the Execution, Goal, Mission, acceptance, evidence snapshot, hashes, and Canonical Proof (`mission-candidate-acceptance.ts:49-177`). | The Apply route selects a matching source Execution by project/proposal (`missions.ts:2278-2450`); the relation is not constrained as unique, and a selected ID is not persisted as Apply-Mission lineage. |
| Proposal → Apply Mission | `missions.ts:2278-2450` creates a separate Mission ID, stores `proposalId` and requirement/hashes inside `autonomyPolicy.applyMission`, and emits an `AiApplyMissionCreated` event. The existing Apply Mission test confirms concurrent requests create one row (`missions.test.ts:6298-6357`). | Proposal preparation, approval, candidate acceptance, duplicate prevention, and transaction rollback are server checked. | There is no FK-backed Proposal → Apply Mission relation, nor a durable canonical/source Execution ID on the new Apply Mission. Existing JSON/event data is insufficient as an independently validated parent link. |
| Apply Mission → verification | `mission-runtime.ts:1588-1610,1668-1712` reloads the durable Execution by apply Goal, project, user, operation, and idempotency key, then loads Canonical Proof with the executing Mission and Goal IDs. | Verification is bound to the Apply Mission's own Goal/Execution and proof; the child Mission's identity is not substituted for the source Mission. | The proof cannot establish which Chat-canonical Mission authorized this Apply Mission. |
| Verification → delivery → receipt | `github-delivery-service.ts:474-580` requires the committed proposal and matching operation before delivery and uses operation-scoped delivery events. `mission-runtime.ts:1635-1764` stores the resulting delivery receipt in Goal acceptance, binding Execution, attempt, operation, revision, candidate/tree hashes, and status. | Delivery and receipt remain tied to the proposal operation and the Apply Mission's accepted Execution. | Neither the delivery receipt nor the delivery event independently names the canonical source Mission or the Apply Mission lineage relation. |
| Refresh/resume | `chat.ts:14846-14910` resolves Missions through owner/project/session-scoped handoffs, then checks the active pointer against those rows. `dashboard.journey.ts:7215-7235` verifies the source Mission survives reload. | The Chat can recover the source Mission after refresh without trusting a stale client-selected Mission ID. | The current E2E verifies source and Apply Mission IDs as separate values connected by a Proposal, but does not verify a persisted canonical-parent relation or include it in the offline receipt. |

### Existing real gateway-action coverage

These are DB-backed route tests through `/agent/action`, not only the
single-handler dispatcher unit test. They establish branch execution and
sequential idempotent replay where stated; they do **not** establish canonical
Mission lineage because no Apply-Mission parent relation exists yet.

| Exact action | Existing route test | Existing failure / replay evidence | Identity-specific gap |
|---|---|---|---|
| `START` | `missions.test.ts:2111` — replay after the Mission decision changes | Same-key replay and changed-decision conflict | No canonical parent asserted |
| `AUTO_CONTINUE` | `missions.test.ts:2170,2243` — Mission Runtime and receipt-write rollback | Accepted-result replay; injected receipt failure rolls back | No canonical parent asserted |
| `RESUME` | `missions.test.ts:2372` — recovery service | Bound recovery capability is reissued on same-key replay; linked-task conflict is covered by the adjacent recovery restriction case | No canonical parent asserted |
| `RETRY` | `missions.test.ts:2438` — retry service | Bound retry capability is replayed; linked-task conflict is covered by the adjacent recovery restriction case | No canonical parent asserted |
| `APPROVE` | `missions.test.ts:2575` — plan-approval service | Persists approval boundary and replays the same result | No canonical parent asserted |
| `REPLAN` | `missions.test.ts:2680` — plan service | Same-key replay preserves one result | No canonical parent asserted |
| `REVIEW` | `missions.test.ts:2807` — non-mutating branch | Decision is recorded without lifecycle mutation | No canonical parent asserted; concurrency is not an applicable effect |
| `STOP` | `missions.test.ts:2729` — cancellation service | Same-key replay is idempotent | No canonical parent asserted |
| `NONE` | `missions.test.ts:2807` — non-mutating branch | Decision is recorded without lifecycle mutation | No canonical parent asserted; concurrency is not an applicable effect |

The shared reservation test at `missions.test.ts:2895` checks revalidation after
reservation, but it is not a concurrent-effect test for every individual
action. Existing Apply-Mission tests also cover duplicate handoff, proposal
mutation during reservation, and rollback after a later transaction write
fails (`missions.test.ts:6298-6564, 6990-7230`). Those cases start from a
proposal without a canonical source Mission, which demonstrates the current
unlinked-Apply-Mission gap rather than proving continuity.

### Pre-change finding and implementation boundary

**Finding: Partially Proven.** Source handoff, Goal/Execution ownership,
candidate acceptance, and Apply-Mission delivery proof are individually
server-bound. The edge from the canonical Chat Mission through the exact source
Execution and Proposal to the separate Apply Mission is not durably represented
and checked as one chain; current delivery receipts cannot close that gap.

The first regression was added before production edits and run through
`node scripts/run-mission-control-tests.mjs`, which creates and tears down a
loopback-only disposable PostgreSQL cluster. The existing selected route group
passed 21/21. The new unlinked-proposal case failed as intended: a request
containing a client-supplied `canonicalMissionId` was rejected with HTTP 400,
but the same prepared Proposal without that extra field created an Apply
Mission with HTTP 201 instead of the required HTTP 409
`MISSION_CANONICAL_IDENTITY_UNRESOLVED`. The test stopped at that assertion, so
it did not yet measure the post-response row-count assertion. No live provider,
shared database, or remote delivery was used.

Before any completion, approval, retry/recovery, or delivery transition can be
credited to the canonical lifecycle, the server must resolve the source from
persisted Proposal → exact accepted Execution → Goal → source Mission and
verify that source Mission's Chat handoff is in the same authorized
project/session. It must create a persisted, FK-backed parent relation in the
same transaction as the Apply Mission and plan, reject ambiguous or unlinked
sources, and have proof/delivery projection reload that relation rather than
accept client-supplied IDs. Historical rows with no provable source remain
unresolved; do not infer a parent from a request, title, session pointer alone,
or a receipt's free-form metadata.
