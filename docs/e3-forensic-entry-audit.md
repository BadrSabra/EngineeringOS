# E3 Forensic Entry Audit

**Date:** 2026-10-05
**Status:** E3 implementation started 2026-10-11; Mission/Goal status-only projections, Mission aggregation race guard, and focused Shadow Replay final-receipt crash recovery updated 2026-10-16. E3 remains OPEN; E3.2 replay safety remains OPEN.
**E2 boundary:** Closed for proof-bound World State materialization as defined in the current project decision.

## 2026-10-11 — explicit E2 closure and first E3 projection slice

The user explicitly closed E2 and authorized E3 after the real API process-recovery test passed with the configured free OpenRouter model and a disposable loopback PostgreSQL cluster. The remaining E2 limitations recorded in the progress log remain limitations; this closure is the user's stage decision, not a claim that every earlier E2 unknown was eliminated.

The P0 dependency-release and Mission-completion boundaries described in the entry matrix are now present in the source: dependent Goals require current Canonical Proof, and aggregate Mission completion reloads proof for the active Goals. A focused `mission-runtime.test.ts` run passed 19 tests on a separate disposable PostgreSQL database.

The first E3 implementation slice fixes Mission Control's terminal projection: `getMissionState` previously selected `Complete` or `Delivered` from execution/flight/timeline status without requiring `PROVEN` when the server marked proof as required. It now projects that mismatch as `Proof incomplete` / `NEEDS_ATTENTION`. The focused Dashboard test file passes 9/9, and Dashboard typecheck passes.

E3 remains open. The next boundaries are Mission/Goal read projections and Shadow Replay receipt freshness. Do not rerun Strategy Replay receipts; no managed API workflow was restarted for this slice.

## 2026-10-16 — status-only projections and Mission aggregation race

Mission and Goal GET/list/projection responses now include `statusProjection: { authority: "STORED_STATUS_ONLY", proofFreshness: "NOT_REVALIDATED" }`. The dashboard identifies stored completion/acceptance values as historical and says current Canonical Proof is not reloaded in these views. The focused route test passed against a disposable loopback PostgreSQL cluster; Dashboard tests and both TypeScript checks passed. A new transaction-level race fixture holds a Canonical Proof acceptance row while another transaction attempts Mission aggregation, rotates the acceptance attempt, then releases the lock. Aggregation waits and returns `needs_replan`; the focused test passed against a separate disposable cluster.

The current Shadow Replay GET and idempotent POST paths call `getShadowReplayReceiptProofFreshness`. It revalidates the completed execution attempt, source/candidate binding, and Canonical Proof before returning `CURRENT`; stale proof remains displayable only with `STALE`. On 2026-10-16, three focused Shadow Replay tests passed 1/1 each on separate disposable loopback PostgreSQL clusters: read/stale/registration plus pre-claim process-kill recovery, interrupted-recipe recovery, and terminal receipt recovery. The terminal test blocks the final `status=completed` update after recipe execution is complete and the replay workspace has been cleaned, then sends `SIGKILL` to the API child. A new API child fails closed with `SHADOW_REPLAY_RECEIPT_MISSING` and registration remains denied. These tests do not run Strategy Replay receipts.

The dependency-release source already locks dependency edges, Goal rows, and execution rows while checking current Canonical Proof; its concurrent attempt-rotation race passed 1/1 on 2026-10-16. Mission aggregation independently passed its concurrent acceptance-rotation race 1/1. The Workflow W9 integration test passed 1/1, keeping an intermediate phase from completing its Goal after a lost acceptance response. Dashboard Tasks tests passed 26/26 and preserve Task-local status wording.

The P2 delegated-child proof aggregation helper remains without a production caller or required-child contract; it stays unused and is not a demonstrated bypass. The terminal receipt fixture now proves fail-closed startup recovery after an actual process kill at the post-cleanup receipt-projection boundary. E3.2 remains open across Strategy Replay and every required lifecycle surface. No Strategy Replay receipt or managed API workflow was run.

## E3 invariant

`PROVEN` is an authority-bearing claim only when it is derived from the current server-owned Canonical Proof for the exact project, operation, execution, attempt, objective/plan revision, and required evidence. Status fields, `evidenceComplete`, provider text, Task-local verification, or a stored replay receipt do not substitute for that proof.

Every producer or decision consumer must either reload/derive the current Canonical Proof or explicitly remain a status-only/read-only projection. Status-only projections must not authorize completion, dependency release, promotion, approval, or successor dispatch.

## E2 → E3 boundary

- **E2 closed here:** execution and attempt identity, accepted effect, required observations, recovery, and proof-bound World State materialization. A pending transition reservation may exist, but before proof completion it creates no facts, materialized transition, or WorldRevision. A manual `/git/push` receipt remains outside World Transition inference.
- **E3 begins here:** consistency of Canonical Proof meaning across completion producers, Mission/Goal aggregation, dependency consumers, replay receipts, and read/API/UI projections.
- **Out of scope for this entry audit:** changing production behavior, expanding World Delta coverage (E4), changing planner policy, Learning/Transfer/Generalization, or adding authority to stored status.

## Current enforcement found

| Boundary | Current behavior | Audit result |
|---|---|---|
| Canonical Proof loader | `loadCanonicalProof` locks the scoped execution, loads acceptance for the exact project/execution/attempt, loads the matching evidence snapshot, and composes the proof against execution and requested scope (`proof-foundation.ts:535-634`). | Strong individual-proof foundation. This is the authority E3 consumers should share. |
| Linked Task → Goal completion | `syncLinkedObjectiveState` reloads Canonical Proof and uses its accepted result when deriving Goal status (`ai-execution-acceptance.ts:610-723`). | Proof-gated writer for this path; Task-local completion alone is not Goal proof. |
| Mission/Goal completion gates | Existing forensic findings show direct Mission completion and linked-objective completion reload Canonical Proof on their guarded paths. | Positive path exists, but it does not make every status aggregator or projection proof-aware. |
| World Transition producers | `apply-changes`, `runtime.start`, and verified `delivery.push.github` have explicit transition/finalizer paths. Generic observation projection is deferred for their transition-owned observations. | E2 closed for the stated materialization invariant. |
| Manual Git push | `GitPushed` is a delivery/activity receipt without execution/attempt/Episode/action/effect/observation binding. | Correctly excluded; it must not be inferred as a World Transition or Canonical Proof. |

## Failure matrix

| Priority | Surface | Failure fixture to require | Required result | Current finding |
|---|---|---|---|---|
| P0 | Goal dependency release | A dependency has `status=completed` but no accepted current-attempt proof, or its proof belongs to a prior plan revision/attempt. | Do not release or dispatch the dependent Goal as proven; return a bounded blocked/replan state. | Current code locks dependency edges, prerequisite Goals, and executions, then reloads Canonical Proof against the active plan revision. Integration cases cover missing acceptance, wrong execution, rotated attempt, stale Episode/plan, incomplete evidence, and races on acceptance attempt and active-plan revision; each fails closed. |
| P0 | Automatic Mission status aggregation | All selected Goal rows say `completed`, but one lacks current proof or is stale against the active plan. | Do not expose a proof-backed Mission completion; distinguish aggregate stored status from verified completion. | `evaluateMissionCompletion` locks Mission/Goal rows and reloads proof per active Goal. Integration cases reject missing acceptance and incomplete evidence; transaction fixtures reject concurrent acceptance-attempt and active-plan-revision rotation. |
| P1 | Mission/Goal API and dashboard projections | A historical `completed` status is returned after acceptance, attempt, or plan proof becomes unavailable/stale. | Keep the value explicitly status-only or return a proof freshness/verdict; never label it Canonical `PROVEN`. | Mission/Goal GET, list, and projection responses mark stored status as `STORED_STATUS_ONLY` / `NOT_REVALIDATED`; dashboard wording treats saved `PROVEN` values as historical. Focused route/UI tests cover the contract. |
| P1 | Shadow Replay receipt reads and idempotent replay | Receipt refers to an old replay attempt or missing/stale acceptance/evidence. | A stored receipt may be displayed as historical metadata but must not authorize registration, approval, or promotion; decision gates reload source and replay proof. | GET/idempotent POST revalidate execution attempt, candidate/source binding, and Canonical Proof; stale data is labeled `STALE` and registration rejects it. Three focused tests passed 1/1 on isolated databases. The terminal test kills the API child at the final receipt-projection update after cleanup and proves that startup recovery fails closed. Strategy Replay receipts remain untested. |
| P1 | Workflow intermediate phase | `evidenceComplete` is true while required evidence/Canonical Proof is absent. | No `PROVEN` acceptance or terminal Goal/Mission completion. | The production caller still fails closed at operation acceptance. The W9 integration test passed 1/1 after a simulated lost acceptance response: the completed non-final phase did not complete its Goal or produce a second acceptance on replay. |
| P2 | Delegated-child proof aggregation | Parent lineage exists but no server-owned required-child contract binds the required children to the parent acceptance. | Keep the helper unused; lineage alone must not establish parent proof. | Existing audit found the aggregation helper has no production caller and lacks a required-child contract. This is an unimplemented capability, not a current production bypass. |
| P2 | Task status and Task verification | A Task is completed/verified while its linked Goal/Mission proof is incomplete. | Preserve Task-local semantics and labels; never promote Task status into Goal/Mission Canonical Proof. | Task completion is labeled “ended according to record”; manual/operator verification is explicitly task/rule scoped. Dashboard `Tasks.test.tsx` passed 26/26. Server Task success remains proof-gated when the linked Mission objective requires proof. |

## Entry decision

1. Treat dependency release and automatic Mission completion aggregation as the first decision-authority surfaces to resolve.
2. Keep read projections, replay receipts, and Task-local status in the matrix as separate freshness/presentation contracts.
3. Preserve the distinction between a demonstrated production bypass, a status-only read surface, and a currently unreachable/helper-only path.
4. Before implementation, define how a historical proof can or cannot satisfy a dependency on a newer plan revision, then add fail-closed integration fixtures for prior attempt, missing acceptance, stale plan revision, and missing evidence.
5. Do not combine this E3 work with E4 World Delta expansion or any Learning/Transfer/Generalization activation.

This remains an entry audit, not an E3 closure. The user explicitly authorized E3 on 2026-10-11; dated addenda below record completed slices and the remaining E3 gates.

## 2026-10-05 four-agent follow-up

The code-first follow-up is recorded in [`agent-core-four-agent-forensic-audit-2026-10-05.md`](agent-core-four-agent-forensic-audit-2026-10-05.md). This addendum does not start E3 implementation or change the scoped E2 materialization decision.

- `loadCanonicalProof()` remains the accepted proof authority for the guarded consumers inspected; the full producer/consumer inventory is not closed.
- `chat-agent.ts` applies required-claim and telemetry gates before the reviewed final-response paths. The observed `chat-required-claim-unclosed-e2e.test.ts` response-classification failure remains unresolved; no persistent acceptance bypass was demonstrated.
- Phase/status and Evidence Graph projections can display `PROVEN` from non-canonical or partial states. Treat these as projection/freshness findings, not as demonstrated acceptance writers.
- `buildEvidenceBackedAnswer()` has no confirmed product-acceptance consumer in the reviewed paths; its authority impact is `UNKNOWN`.
- Apply W0–W8 tests cover bounded apply/startup and HTTP-route crash cases. Earlier progress records a successful isolated run; the follow-up audit did not rerun it. Those Apply tests do not close E3.2 replay safety across source/replay receipts and other mutation surfaces.
- Keep E3.2 `OPEN` until current-attempt replay proof, receipt persistence/recovery, and all required replay consumers are covered by broader evidence and verified tests.

## 2026-10-07 contract refinement — documentation only

This refinement does not start E3 implementation, pass E2, or authorize Strategy Replay. E2 remains active; E3 remains stopped until the E2 gate explicitly passes.

### Decision-consumer contract

Treat a surface according to the decision it makes, not merely the status field it reads:

- Any authority-bearing decision that relies on completion or `PROVEN`—including dependency release, successor dispatch, acceptance, approval, or promotion—must reload or derive the current server-owned Canonical Proof for the exact authorized scope. A stored `completed`/`PROVEN` value or receipt is not sufficient.
- A read/API/UI projection that does not load current proof remains explicitly status-only or historical. It must not be consumed by an authority-bearing path.
- Task-local verification, Mission/Goal completion, effect acceptance, and World Transition are separate claims. Evidence for one must not silently promote another.

### First E3 implementation boundary after authorization

Use the existing failure matrix to scope, rather than broaden, the first implementation slice:

1. **Goal dependency release:** define whether and under what exact conditions a proof from an earlier plan revision can satisfy a dependency in the active plan. Until that policy is explicit and enforced, missing, stale, or revision-ambiguous proof must block release rather than inherit authority from `status === "completed"`.
2. **Mission aggregation:** distinguish stored aggregate status from proof-backed completion. Do not describe an aggregate as Canonically proven unless the required Goal proofs are current for the defined Mission scope.
3. **Projections and replay receipts:** preserve useful historical display, but label freshness and keep the values non-authoritative. Decision gates must reload the source and replay proofs for the current attempt.

Keep these as separate contracts and test classes; a projection finding is not automatically a writer bypass, and an unreachable helper is not a production path.

### Required stale-read race fixture

For each authority-bearing consumer in scope, include a deterministic race case:

```text
A reads a valid dependency/proof
B changes the dependency, active revision, attempt, or cancellation state
A attempts to commit authorization or release the successor
```

The result must be a bounded block/replan or a decision based on freshly revalidated state. The test must exercise the production transaction/lock or compare-and-set boundary; a helper-only mock does not establish race safety. Dependency-release attempt rotation and Mission-aggregation acceptance rotation now have transaction-level fixtures. Keep missing-proof, prior-attempt, stale-revision, incomplete-evidence, and crash/replay receipt recovery as separate contracts.

This is a proposed E3 acceptance contract only. Do not expand it into World Delta work, a new universal authorization service, or Learning/Transfer/Generalization.

## 2026-10-16 — paired-baseline receipt decision consumers

The production decision consumers found are the shared chat helper used by proposal recovery/resume and automatic delivery-promotion eligibility, plus Gate 4's `validateSkillRegistryAuthority` → `buildSkillShadowScore` path. Shadow Replay GET/idempotent POST checks current source and replay proof freshness but remains presentation-only. `proof-spine` only projects status and is not an authority-bearing consumer.

Two identity gaps were reproduced before changing the guards:

- For automatic delivery eligibility, a `passed` comparison with the current replay's Canonical Proof and matching candidate hashes, but foreign `pairId` and `candidateRunId`, produced `AUTO_PROMOTE_ELIGIBLE`. No apply handler or live file write was invoked.
- For Gate 4, the score helper returned an eligible score with a foreign baseline run ID, foreign candidate run ID in the pair contract, or foreign contract source revision while `pairId` and tree hashes still matched. The test stopped at the helper; no Skill registration or approval mutation was invoked.

The guards now bind both top-level and contract baseline/candidate run IDs, pair ID, source revision, candidate ID, and baseline/candidate tree hashes to the current replay and proposal. Gate 3 also validates the version-2 durable receipt against the current replay row, attempt, execution proof, operation, change set, and source workspace. Gate 4 rejects a missing base tree hash and reuses the same strict paired-baseline identity requirements.

Verification: the focused E3 group passed 5/5 on an isolated loopback PostgreSQL database, and the recovery-route group previously passed 19/19. Four post-eligibility races (source-revision contract, Canonical Proof attempt, baseline run ID, candidate run ID) still use mocked validation and all reach the real `applyChangesHandler`, which returns 207 with `automaticPromotion=true`, `writeStatus=not_written`, and `paired_baseline_missing`; the live tree remains unchanged. The matching-pair control now runs the registered `workspace-typecheck` validator for real (`pnpm run typecheck`) in a minimal isolated fixture with a TypeScript source file; it receives passed evidence and writes the exact proposed `README.md` bytes, returns `applyStatus=APPLIED`/`integrityOutcome=verified`, records an `APPLIED` journal, and leaves the live tree hash equal to the candidate hash. An initial fixture-only tree-hash mismatch was traced to an extra directory created while preparing root-level `tsconfig.json`; the fixture was corrected before the passing rerun. The Gate 4 HTTP route journey in `ai/missions.test.ts` passed 1/1: mismatched `pairId` and `baselineRunId` each block registration without creating a registry row; mismatched `candidateRunId` and contract `sourceRevision` each block approval while the row remains pending and no plugin binding is created. Restoring the matching receipt permits registration and approval. The existing Skill Registry unit test passed 11/11; the API TypeScript check passed. The earlier run-ID trigger fixture also required an explicit `text` cast for PostgreSQL `to_jsonb`.

Boundary: the real validator was run only against the minimal isolated TypeScript fixture, not a full workspace; validation remains mocked in the four race cases. Gate 4 route coverage now exercises `pairId`, baseline/candidate run IDs, and contract `sourceRevision`, but not every possible contract or authorization mutation. Its fixture uses the Shadow Replay route; no Strategy Replay receipt was run. E3 and E3.2 remain open, E4 was not started, the managed API workflow was not restarted, and no shared database was used.

## 2026-10-17 — Evidence Graph status projection

The Dashboard Evidence Graph panel previously rendered a stored `PROVEN` node as a green positive status, with a general disclaimer that the graph did not prove execution completion. The panel now labels that value “مثبت في الخريطة فقط” in a neutral style and explicitly says the current execution acceptance is not rechecked and completion is not established. The graph node value remains unchanged; this is a presentation/freshness correction, not an acceptance or authority change.

The focused component test passed 7/7 and Dashboard TypeScript check passed. The Dashboard workflow restarted and Vite became ready. The public preview showed the sign-in page, so the authenticated Evidence Graph panel was not visually verified; its component behavior was verified by tests. At the time of this UI-only slice, the API still returned the stored graph status without freshness metadata; the later addendum below records the correction. Other Phase/status projections remain outside this slice. E3 and E3.2 remain open; no Strategy Replay receipt or E4 work was run.

### 2026-10-17 — API projection test failure, recorded before repair

The first focused route test for Evidence Graph freshness metadata failed because the JSON response's `toolTrace` did not expose the expected `statusProjection`. This failure establishes only that the tested JSON projection lacked the expected metadata; it does not establish that a `PROVEN` graph status changed Canonical Proof, acceptance, or repair authority. API and Dashboard typechecks passed, and the focused fixture-Finding UI test passed. No managed API workflow or shared database was used.

### 2026-10-17 — fixture-local Finding boundary and API freshness resolution

The focused `AiChat.authenticated.test.tsx` case passed 1/1. It keeps a fixture-local `findingStatus: PROVEN` visible as `FINDING PROVEN` while `productionReachability: NOT_PROVEN` and `repairReadiness: BLOCKED`; the report explicitly leaves production reachability and repair authorization blocked. This is a Finding-level verdict, not Canonical Proof or repair authority, so no semantic change was made to that label.

The API now includes an optional, typed `EvidenceGraph.statusProjection` for backward compatibility. Server serialization stamps `authority: EVIDENCE_GRAPH_ONLY` and `proofFreshness: NOT_REVALIDATED`; history projection discards any persisted value and re-derives the same server-owned metadata. The initial JSON test failure was traced to the JSON route omitting `result.evidenceGraph` when it serialized `toolTrace`. The route now passes the graph through the same serializer as SSE. The route test supplies a forged provider projection, verifies that the server value replaces it, and confirms the graph node remains `PROVEN` across JSON, SSE, persistence, and history.

Verification: API `chat-sse.test.ts` passed 50/50; the focused Finding test passed 1/1 and `EvidenceGraphPanel.test.tsx` passed 7/7. API and Dashboard TypeScript checks, API contract codegen, and `git diff --check` passed. Dashboard restarted cleanly; the preview showed the public landing page, so the authenticated graph panel remains unverified visually. The managed API workflow was not restarted, and no database was used. E3 and E3.2 remain open; other Phase/status projections remain outside this slice. No Strategy Replay receipt or E4 work was run.

### 2026-10-17 — Active execution-plan Finding status

The `ActiveTaskExecutionPlan` projection maps a scoped phase verdict to `PROVEN` only on the `finding:<id>` claim. Separate objective claims are created as `PENDING`; the tool-loop's objective claims are computed independently. The plan retains `verdictScope` and `scopedFindingStatus`, and reuse is gated by the enclosing task state's workspace revision. This status is internal execution-plan context, not a Canonical Proof or current execution acceptance returned by the API.

The handoff boundary remains separate: a fixture-local plan can have plan readiness `READY`, but a fixture repair is accepted only with the server-owned exact-scope benchmark capability. The restored-scope regression test blocks a persisted `FIXTURE_PROVEN` plan before any tool call. A focused run of that block test first exceeded Vitest's default 5-second timeout after logging the expected scope-gate decision; rerunning with a 15-second test timeout passed 1/1. No files were written by the blocked case. The task-session-state test now asserts that a `PROVEN` Finding claim leaves its objective claim `PENDING`.

Conclusion: this candidate does not demonstrate that a Phase result closes a current objective or represents accepted execution. The Dashboard's `REPAIR_RESULT` card now states that `READY` describes plan readiness only and does not establish current execution acceptance or completion. The stored status value, backend readiness, and authority are unchanged. Its focused component test passed 1/1, Dashboard TypeScript check passed, and the Dashboard workflow restarted cleanly. The preview screenshot showed the public landing page; the authenticated card was not visually verified. E3 and E3.2 remain open; no Strategy Replay receipt, E4 work, managed API restart, or shared database was used.

### 2026-10-17 — Mission and Goal status projections

Mission and Goal APIs stamp `STORED_STATUS_ONLY` / `NOT_REVALIDATED` on stored lifecycle statuses. The Dashboard does not rely on that metadata alone: the Mission list explains that statuses come from the record and do not mean current Canonical Proof was checked; completed Goals show the same boundary, and the acceptance notice describes stored proof as not revalidated. The chat handoff view also says Mission/Goal statuses are stored-only and does not reload current Canonical Proof.

The separate execution capsule derives completion from terminal execution status plus passed verification and a `PROVEN` evidence verdict; `mission-state.test.ts` includes retained-phase cases and an unavailable-verification case. Dashboard `Missions.test.tsx` and `mission-state.test.ts` passed 28/28 together. The API route test contains assertions for the status-projection stamp across Goal/Mission detail, lists, and the combined projection. On 2026-10-17, three focused route cases passed across two disposable loopback-only PostgreSQL clusters: status-only metadata across detail/list/combined projection (1/1), active-revision Goal and latest-attempt selection (1/1), and current Task-correlation selection over a higher historical Goal attempt (1/1). These cases verify the read projection contract only; they do not reload Canonical Proof or authorize lifecycle decisions.

Conclusion: no unqualified Mission/Goal completion claim was found on the inspected UI paths. No code change was needed. E3 and E3.2 remain open; this does not certify other status surfaces or complete the broader audit.

### 2026-10-17 — Workflow completion and phase-status projection

The workflow advance route marks a run `completed` when the current phase is the last one, after its advance condition passes. The route refuses to advance phases with declared steps because no runner can execute them with accepted evidence; empty phases are no-op boundaries. Therefore, workflow and phase completion states are process-record statuses, not proof that project changes were accepted or that Canonical Proof was revalidated.

The Dashboard now says these statuses are recorded state, changes the completed-run label to “انتهى التشغيل بحسب السجل”, and labels completed phases as recorded completions. The initial focused UI run passed 9/10 tests; the single failure was an existing assertion still expecting “مراحل مكتملة” after the intentional copy change. This was a presentation-text mismatch only: it did not exercise or establish a workflow transition, accepted execution, or proof behavior. After recording the boundary and updating the expectation, the combined Workflows, Tasks, and result-details suite passed 46/46; Dashboard TypeScript and `git diff --check` passed. Dashboard restarted and Vite became ready. The preview showed the public landing page, so authenticated Workflows and Tasks screens were not visually verified.

E3 and E3.2 remain open. This correction does not certify other Task/Workflow projections, and no managed API workflow or shared database was used.

### 2026-10-17 — Task list terminal-status wording, recorded before repair

Added a focused assertion for a legacy Task with `status=completed` and no acceptance record. It failed because the list row rendered the raw English status `completed`, while the expanded detail already labels the same state “انتهت بحسب السجل”. The failure is limited to the Task list's wording and does not establish an acceptance, Canonical Proof, or backend lifecycle defect; no mutation or authorization path was exercised. The row now uses the existing record-status label helper, and the regression assertion passes in the combined 46/46 Dashboard test run.

### 2026-10-17 — Task progress from a prior correlation, recorded before repair

A focused timeline fixture used the Task's current correlation for its terminal event and a different, prior correlation for a completed context-stage event. The test failed because the Dashboard selected the latest event per stage across all task logs and showed the prior context stage as completed in the current plan. This establishes a stale progress-projection leak across task correlations; it does not establish a false server acceptance or a progress-writer ownership defect. The acceptance gate, current terminal event, and mutation paths were not exercised or changed. The UI now limits stage and percentage projections to structured logs matching the Task's current correlation and the `attempt` reported by its current linked AI execution. If that identity cannot be validated, or its query is refreshing while the Task is running, those structured logs are withheld; the activity feed continues to retain prior events as history.

The first post-fix rerun passed the new stale-correlation and stale-attempt timeline assertions, then failed at a pre-existing singular query for the generic “تقدم التنفيذ” activity label. The expanded fixture contains two distinct progress events that intentionally share that label. This is an ambiguous test selector after fixture expansion, not a duplicate activity or a status-projection regression. After making that query plural, the focused timeline test passed 1/1. The combined Workflows, Tasks, and result-details suite passed 46/46; Dashboard TypeScript and `git diff --check` passed.

The Dashboard workflow was restarted after the UI changes and Vite became ready. The public preview loaded; signed-in Task and Workflow screens were not visually verified. No API workflow restart or shared database was used.

### 2026-10-17 — Task progress percentage from a prior correlation, recorded before repair

A focused retry fixture gave the Task a new current correlation and status `queued`, while its only progress-percent row belonged to the prior correlation and reported 96%. The test failed because the Dashboard's summary card selected the newest percent from all Task logs and displayed `96%` as current progress before the new execution emitted any progress row. This is a stale UI summary projection, not evidence of acceptance, Canonical Proof, or an execution/authorization defect. The server acceptance path, progress writer, and mutation behavior were not exercised or changed.

The regression fixture was then extended to model resume: the Task and persisted AI execution keep the same correlation, the execution row reports attempt 2, and its newest Task progress event is still from attempt 1 at 96%. The focused test failed on that value as well. Source inspection confirms that resume retains the execution correlation while `claimAiExecution` advances its durable attempt. Thus, choosing the maximum attempt present in Task logs is insufficient before the resumed attempt's first progress event. This remains a UI projection issue only; the test does not exercise or challenge the server acceptance gate.

After binding progress to the execution endpoint's durable attempt, a second case exposed cached-query freshness: while a running Task's execution query reported `isFetching=true` with cached attempt 1, the progress card still used the 96% attempt-1 row. The focused test failed on that stale cached value. The Dashboard must withhold current-attempt progress while a running execution identity is being refreshed; this does not imply any acceptance or runtime defect.

Resolution: the Dashboard now reads the attempt from the server-owned execution record, validates its ID, Task link, and correlation, and uses that exact attempt for both the phase plan and percentage summary. While the current execution query is refreshing during a running Task, historical structured progress is not projected as current. The current-attempt timeline and resumed-attempt stale-percent regressions pass. The combined Workflows, Tasks, and result-details suite passed 47/47; Dashboard TypeScript and `git diff --check` passed. The Dashboard workflow restarted and Vite became ready. The public preview loaded; the authenticated Task details were not visually verified, and the browser capture reported a 404 for the Replit dev-banner resource. No API workflow restart or shared database was used.

### 2026-10-17 — Cached Task acceptance during detail refresh, recorded before repair

A focused UI fixture gave the task list the current `running` state while the Task-detail query was still fetching and retained a prior `verifying` response with a resumable acceptance from attempt 1. The test failed because the acceptance panel rendered that cached result and its Resume button as current. The source resolver joins acceptance to the Task's current correlation and the linked AI execution's exact attempt; the regression is in the Dashboard's stale-query projection, not evidence of a server acceptance defect. The test only rendered a stale-cache fixture and did not issue a resume request or mutate data.

A separate list fixture retained an accepted attempt-1 row while the Task-list query reported `isRefetching=true`. Its focused test failed because the row still displayed the “مقبول” badge. This is another stale client-cache projection; it does not contradict the server's current-correlation/current-attempt resolver and exercised no mutation.

A pending-resume fixture with a non-fetching cached Task detail also failed: the prior attempt-1 acceptance remained visible while the Resume request was pending (although its button was disabled). This confirms that query-fetch gating alone is insufficient; the mutation-pending state must also withhold the old result from the current-acceptance panel. No resume request was actually sent by the test.

Resolution: the detail panel now withholds cached acceptance while its query is fetching, while the current Task row is running, or while resume is pending. List acceptance badges and outcome filtering are also withheld during list refetches, pending resume, and running status. The Tasks page suite passed 30/30, Dashboard TypeScript and production build passed, and `git diff --check` passed. Build output retained existing source-map and large-chunk warnings. The Dashboard workflow restarted and Vite became ready; the preview's public landing page loaded. The Task details remain behind authentication and were not visually verified. The browser reported the existing dev-banner resource 404. No API workflow restart or database was used. This closes only the identified UI projection gap; E3 and E3.2 remain open.

### 2026-10-17 — cached Task execution receipt during resume, recorded before repair

A Dashboard fixture retained an `AI_TASK_EXECUTION_RECEIPT` in the Task-list cache while the resume mutation was pending. The focused test failed because the expanded Task details still rendered the prior “إيصال التنفيذ” card. The server projection helper binds recognized receipts to the Task's current correlation, linked execution, and exact current attempt; this failure is a stale client-cache projection, not evidence of a server receipt-identity defect. The test did not send a resume request or exercise an API route.

A second fixture retained the same kind of receipt while the Task-list query was refetching. The acceptance badge was withheld by the earlier fix, but the expanded details still rendered the cached receipt card. This confirms that receipt display needs the same list-cache freshness gate; the fixture did not call the API or mutate data.

### 2026-10-17 — cached Mission capsule during execution refresh, recorded before repair

A Dashboard fixture supplied a running Task and a cached execution projection whose Task link and correlation matched, while the `useGetAiExecution` query reported `isFetching=true`. The test failed because the Mission capsule remained rendered. This demonstrates that correlation matching alone does not suppress cached capsule data during current-execution refresh; it does not establish that the fixture's cached projection was in fact from a prior attempt or that the capsule is Canonical Proof. The test sent no mutation and made no API or database request.

### 2026-10-17 — cached Task verification result during resume, recorded before repair

A Dashboard fixture retained a passed Task verification result while the resume mutation was pending. Its focused test failed because the expanded Task details continued to show the verification steps without identifying them as historical. This is a stale task-state presentation during the active resume window; it does not establish that the stored verification record is false or that it can satisfy Canonical Proof. No resume request or API/database operation was executed.

Resolution: the Task list now withholds acceptance, execution receipts, and verification steps while the list query is refetching, resume is pending, or the Task is running. Acceptance-based filtering follows the same rule. The Mission capsule also stays hidden while resume is pending or while a running Task/execution query refreshes; its existing linked-Task and correlation checks remain in place. Source inspection confirms the lifecycle marks the Task `running` at claim and writes a fresh receipt and verification result at finalization; no database-backed lifecycle test was run here. The focused Tasks suite passed 34/34, Dashboard TypeScript and production build passed, and `git diff --check` passed. Build output retained source-map and large-chunk warnings. Dashboard restarted and Vite became ready; the public landing preview loaded, but authenticated Task details were not visually verified. The existing dev-banner resource returned 404. No API workflow restart or database was used. This closes only these stale UI projection gaps; E3 and E3.2 remain open.

### 2026-10-17 — missing/stale proof gates for Goal release and Mission aggregation

The Goal dependency gate already had static failures for missing acceptance, wrong execution, prior attempt, stale Episode/plan, and mismatched observations. The missing consumer-level evidence case was an acceptance whose stored projection still says `PROVEN` while its referenced evidence snapshot is incomplete. Mission aggregation also lacked direct cases for missing acceptance and incomplete evidence, and each decision path had only an attempt-rotation race fixture rather than an active-plan-revision rotation fixture.

The `mission-runtime.test.ts` fixtures now verify that dependency release blocks on the incomplete evidence snapshot, that Mission aggregation rejects both missing durable acceptance and incomplete evidence, and that both decision paths re-read the active plan revision after waiting on the Mission row lock. A stale dependent Goal remains queued and returns `stale_plan_revision`; aggregation returns a non-proven result bound to the rotated revision. The full file passed 51/51 against a disposable loopback-only PostgreSQL cluster; API TypeScript and `git diff --check` passed. No production code changed, no shared database or provider was used, and the managed API workflow was not restarted. These tests strengthen the two P0 gates but do not close E3 or E3.2.

### 2026-10-17 — completed Goal proof-contract edit failure, recorded before repair

Two focused HTTP route cases seeded a completed Goal and Mission with current Canonical Proof, then attempted to change the Goal's `successCriteria` or `evidenceContract` without changing its status or plan revision. Both cases failed because PATCH returned HTTP 200 instead of the expected rejection. This establishes that the route accepts proof-contract edits while the Goal is still recorded completed; the failed assertion stopped before post-response persistence checks, so no stronger claim is made here. The cases ran on a disposable loopback PostgreSQL cluster only; no shared or production state, provider, or API workflow was used.

A third case then reopened a proof-backed Goal to `needs_replan` in an active Mission and changed `successCriteria`. That PATCH also returned HTTP 200 instead of the expected rejection. This confirms that a guard based only on the current Goal status would be bypassable after reopening; the relevant identity is the durable execution history, not the mutable status field. Its post-response persistence assertion was likewise not reached. The reproduction used a separate disposable loopback PostgreSQL cluster and did not touch shared state or a running API workflow.

A fourth case created a queued execution for a Goal and then changed `successCriteria` before the execution ran. PATCH returned HTTP 200 instead of the expected conflict. This demonstrates that the route also leaves the proof contract mutable after execution has been queued, not only after completion. The persistence assertion did not run after the response mismatch; the case used only its isolated disposable database.

The PATCH route now compares `successCriteria` and `evidenceContract` structurally. On a completed Mission, changing either contract requires Mission reactivation. Otherwise, a queued/running execution or a completed successful acceptance with required, complete evidence locks the Goal proof contract and returns `GOAL_PROOF_CONTRACT_LOCKED`; a new Goal or replan is required to establish a new scope. This conservative lock avoids claiming that Canonical Proof hashes mutable Goal JSON fields when it does not.

Verification: the four focused regressions passed 4/4, and the full Mission route file passed 40/40 against disposable loopback-only PostgreSQL databases. API TypeScript and `git diff --check` passed. The managed API workflow was rebuilt and restarted; logs show the server listening with no startup error. No shared or production database was used for the tests. E3 and E3.2 remain open; E4 and Strategy Replay were not started.

### 2026-10-17 — Goal creation on a completed Mission, recorded before repair

A focused POST route case seeded a completed Mission with a current proof-backed Goal, then submitted a second Goal on that Mission. The endpoint returned HTTP 201, the durable Goal count increased from one to two, and the Mission row remained `completed`. This establishes that the create route permits adding unproven work to a completed Mission and leaves its stored status unchanged. It does not establish that the new Goal received Canonical Proof; the inconsistency is in the stored lifecycle state. The case used only a disposable loopback PostgreSQL cluster.

Resolution: Goal creation now locks the Mission row before insertion and rejects a still-completed Mission with HTTP 409 `MISSION_REACTIVATION_REQUIRED`. The existing Mission PATCH `status: active` path is the explicit reactivation step. The shared materializer binds each new Goal's criteria, evidence contract, outcome contract, and dependency edges to `planSnapshot.hash`, then updates the Mission's `activePlanRevision` in that transaction. Automatic replan derives an explicit `auto:<failed-goal-or-mission-id>:<plan-hash>` revision; retries reuse reconstructable Goal/task mappings for that same revision rather than rewriting old proof contracts. The audited execution and acceptance writers update status and acceptance projection, not existing `successCriteria` or `evidenceContract`.

Verification: the completed-Mission POST guard and completion/creation race cases passed; the complete Mission route file passed 42/42 on a disposable loopback-only PostgreSQL cluster. API TypeScript and `git diff --check` passed. The API workflow restarted and its health endpoint returned 200. E3 and E3.2 remain open; E4 and Strategy Replay were not started.

### 2026-10-17 — OperationEvidence plan-scope false negative, recorded before repair

A focused database integration case stored a successful acceptance and complete evidence snapshot for the current execution attempt. The Goal's `planRevision` matched the Mission's `activePlanRevision`, but `loadOperationEvidence` returned the loaded Canonical Proof as `accepted=false` / `INCOMPLETE`. The caller supplied `activePlanRevision` without the Goal's `planRevision`, and the Canonical Proof composer correctly rejected that incomplete plan scope with `plan_revision_mismatch`.

This is a false negative in the read-only OperationEvidence projection, not an acceptance or authorization bypass: the outer projection remains `verified=false`, and the case made no lifecycle transition or mutation request. The focused test used a disposable loopback-only PostgreSQL cluster; it does not establish behavior for other consumers or production data. This observation is recorded before changing the projection.

Resolution: `loadOperationEvidence` now supplies the Goal's plan revision, reading `outcomeContract` first and `successCriteria` second, alongside the Mission's active revision. It preserves Canonical Proof rejection when those revisions differ and keeps the aggregate OperationEvidence projection non-authoritative.

Verification: the focused integration case and the OperationEvidence and Canonical Proof unit suites passed 16/16 on a disposable loopback-only PostgreSQL cluster; API TypeScript and `git diff --check` passed. This closes only the plan-scope under-reporting in this read projection. E3 and E3.2 remain open; E4 and Strategy Replay were not started.

Freshness boundary: OperationEvidence reads Goal and Mission scope before its separate Canonical Proof transaction locks the execution. The concurrent plan-change case was later reproduced and repaired below. The projection remains `verified=false`, and source search found it only in execution-status, audit-export, and benchmark responses; no authority-bearing consumer was found. As with any read response, a plan may change after the final freshness read, so this remains a non-authoritative snapshot rather than a lifecycle guarantee.

### 2026-10-17 — OperationEvidence concurrent-plan freshness, recorded before repair

A deterministic integration test paused `loadOperationEvidence` after it had read Goal/Mission scope but before its Canonical Proof transaction. The test then rotated Mission `activePlanRevision` while keeping the completed Goal and acceptance on the former revision. The projection still returned `proof.accepted=true` / `PROVEN`, confirming that this response could present an old-plan proof as current during the read window.

The test used a disposable loopback-only PostgreSQL cluster and changed only a generated fixture. It establishes a stale read in this non-authoritative projection, not an acceptance write, lifecycle transition, or authorization bypass. No production data was touched.

Resolution: after loading Canonical Proof, OperationEvidence now re-reads the Goal and Mission plan scope. If the Goal/Mission relation, completion status, Goal plan revision, or active Mission plan revision changed during the request, both the proof and proof-spine projections are downgraded to `INCOMPLETE` with a bounded failure reason. The deterministic concurrency case and the OperationEvidence/Canonical Proof unit suites passed 17/17 on a disposable loopback-only PostgreSQL cluster; API TypeScript passed. This closes the reproduced stale-plan window without adding cross-path row locks. E3 and E3.2 remain open; E4 and Strategy Replay were not started.

### 2026-10-17 — Mission recipe pre-claim race test: initial fixture failure

The first focused run of the new recipe-claim race case stopped with `CAPABILITY_UNKNOWN_ID` during recipe preparation, before `beforeClaim` or `claimAiExecution` ran. The fixture had not supplied the server-owned `runtime.start` runner. This establishes only a test-fixture setup failure; it does not exercise the Mission plan race and is not evidence of an application failure or a safe boundary.

The run used a disposable loopback-only PostgreSQL cluster and touched only its generated fixture. No production code was changed in response to this result. Correct the fixture before drawing a conclusion about the claim boundary.

### 2026-10-17 — queued Task resume attempt-race fixture timeout, recorded before redesign

The existing Task-pointer race case passed after being paired with a new case that advanced the linked execution attempt after Task preflight. The new attempt case timed out at the test's 20-second limit while waiting to complete its synchronization path. No behavioral assertion completed, so this does not establish either an attempt-fence bypass or a production defect.

The test used a disposable loopback-only PostgreSQL cluster, which was stopped and removed by its shell cleanup. The fixture tried to change the execution attempt at a synchronization point that may already be behind the execution-row claim lock. Redesign the interleaving so the attempt changes before the transactional resume check acquires that row; do not interpret the timeout as an application result.

### 2026-10-17 — Mission recipe claim and Task resume attempt fences: resolution

Mission recipe dispatch now passes the existing transaction from `runRecipeOperation` into `authorizeMissionRecipeDispatch`; the Mission/Goal locks, paused-resume token recovery when applicable, and `claimAiExecution` remain in that same transaction. The race fixture now passes 1/1: a plan update cannot commit before claim, and is visible after the claim transaction releases its locks. On one disposable loopback-only PostgreSQL cluster, `mission-runtime-recipe.test.ts` passed 23/23, followed by the focused claim plus Mission runtime/D2 cases passing 2/2. API TypeScript and `git diff --check` passed after explicitly typing the authorization closure's discriminated return.

The Task resume race now has two focused cases: a changed Task pointer and a changed linked execution attempt. Both passed 1/1 each on a disposable loopback-only PostgreSQL cluster. In the attempt case, the test commits an attempt advance after the lifecycle's initial read and immediately before calling the real `recoverAiExecutionResumeToken`; the old expected attempt is rejected as `execution_identity_changed`, the attempt-1 execution remains failed with its existing token hash, and its only acceptance remains attempt 0. The first lock-based attempt fixture timed out because it tried to mutate the execution at a point that could already be protected by the claim transaction; the replacement synchronization tests the actual resume guard without waiting behind that claim lock.

These tests do not run Strategy Replay, E4, a production provider, or a production-data mutation. The recipe claim test intercepts before any recipe node/effect; the Task attempt test does not invoke the provider or create an Episode. The managed API workflow restarted and `/api/healthz` returned `ok`; Dashboard was not restarted. E3 and E3.2 remain open.

### 2026-10-17 — production Mission callback fixture denial, recorded before correction

The first test of the production `beforeClaim` closure returned `false` for the queued-recovery fixture. The mocked runner then continued to seed a synthetic successful receipt, so the later Goal-completed assertion was not valid evidence about authorization. The failure proves only that this fixture was not admissible at the callback boundary; it does not establish a production bypass or acceptance.

The fixture binds `sourceRevision` to a placeholder string even though its test root is a committed Git repository and the production callback revalidates the current source revision. That is the leading fixture mismatch to correct. Keep the test fail-closed: a denied callback must never proceed to synthetic proof seeding.

Resolution: the recovery fixture now binds to the test repository's actual Git HEAD and the mock refuses to seed success after a denied callback. The production `executeMissionRecipe` callback returned allowed while a separate Mission-row update remained blocked until its transaction ended; the focused test passed 1/1. A second focused Task test exercised the real Mission-linked `executeTaskLifecycle` admission and claim path: active-plan rotation remained blocked at claim, the update committed after transaction rollback, no execution row or Task lease persisted, and no provider ran. It passed 1/1. Both tests ran sequentially on one disposable loopback-only PostgreSQL cluster.

These focused fixtures verify production Mission authorization and Task admission boundaries, while the separate recipe-runner race test verifies that its supplied callback transaction is also used by the real `claimAiExecution`. No recipe node/effect, provider, Strategy Replay, E4, or shared/production database was used.

### 2026-10-17 — Mission recipe stale-plan claim race, recorded before repair

After adding the missing server-owned runtime runner to the fixture, the focused test reached the real recipe claim path. Its admission callback read and locked plan v1, then committed a Mission update to plan v2 before returning. `runRecipeOperation` still called `claimAiExecution`; the claim observed plan v2, while neither admission nor claim received a shared transaction. The regression test failed its same-transaction and current-revision assertions on a disposable loopback-only PostgreSQL cluster.

The test invokes the real `claimAiExecution` but intercepts its result before any recipe node runs. It therefore establishes that a queued Mission recipe can cross the execution-claim boundary after the active plan changes; it does not show a recipe effect, Canonical Proof acceptance, Task/chat recovery bypass, or production-data mutation. The production Mission callback performs its authorization in `authorizeMissionRecipeDispatch`, whose transaction currently ends before the runner's separate claim. Fix and re-test this narrow queued-Mission-recipe boundary before extending the finding to other paths.

### 2026-10-17 — transactional admission typecheck failure, recorded before correction

After the claim transaction change, the Mission recipe integration tests passed 23/23 and the focused claim/D2 tests passed 2/2 on a fresh disposable loopback-only PostgreSQL cluster. API TypeScript then failed with TS2322 at the new transaction-aware authorization wrapper: TypeScript widened the closure's `{ allowed: true }` result to `boolean`, which did not fit the declared discriminated union.

This is a compile-time return-type inference failure only. It does not negate the passing database tests or indicate a runtime/data failure. The fix is limited to explicitly typing the authorization closure's return contract; no production data was involved.

### 2026-10-17 — Task receipt and durable lifecycle identity verification

The focused Task API route case `returns an AI Task receipt only for the pointer-bound execution and exact attempt` passed 1/1 on a disposable loopback-only PostgreSQL cluster. It verifies the read projection does not return a receipt for a different Task execution pointer or attempt.

Three selected `task-execution-lifecycle.integration.test.ts` cases passed 3/3 on another disposable loopback-only PostgreSQL cluster: completed Task plus terminal acceptance persistence; rejection of a stale retry generation or execution pointer before creating an execution; and rollback of Task success projections when finalization fails after acceptance insertion. The lifecycle fixture uses mocked provider behavior. Together with the route case, this verifies the selected durable write/read boundaries for Task acceptance and attempt identity; it does not prove the complete producer/consumer inventory.

No production provider, shared or production database, Strategy Replay, E4, or managed app workflow was used. E3 and E3.2 remain open.

### 2026-10-17 — stale-attempt recovery and structured terminal projection

Two recovery-coordinator cases passed 2/2 on a disposable loopback-only PostgreSQL cluster: stale Task acceptance and stale Chat acceptance from a prior attempt both produce no queued recovery work. A concurrent JSON-turn case passed 1/1 on a separate disposable cluster; the newer resumable plan remains persisted after the older turn finishes later. A mocked structured-analysis fallback case passed 1/1 and confirmed the same terminal identity is projected across SSE, execution detail, and chat messages.

Source review of the structured terminal projection found that it selects acceptance by the execution's exact current attempt and returns that attempt explicitly. The UI labels it as terminal status/resumability, not Canonical Proof; the accepted-Mission action separately requires the proof/evidence verdict from the execution projection. `taskObjective.status` is a server-owned validator summary persisted separately from the Canonical Proof projection and is not used by the UI as proof authority. No additional decision-authority gap was demonstrated in this path.

The tests used mocked model behavior and isolated databases. No production provider, production/shared database, Replay, registration/approval action, E4, or managed app workflow was used. This closes only this terminal-projection/recovery slice; E3 and E3.2 remain open.

### 2026-10-17 — Canonical Proof foundation and acceptance contract checks

`proof-foundation.test.ts` passed 11/11, including the historical-acceptance/current-attempt rejection, stale plan/candidate bindings, and incomplete-evidence cases. Four selected `ai-execution-acceptance.test.ts` cases passed 4/4: current-attempt acceptance allowlisting, validator state kept separate from proof metadata, bounded proof/trajectory projection, and optional-evidence success remaining non-proven. These are unit/fake-transaction tests; no database server or provider was started.

The Apply recovery integration file was inspected but not run because it also contains replay cases. No replay, registration/approval, production data, or production code change was made. This reinforces only the reviewed proof/acceptance contracts; the broader consumer inventory remains open, and E3/E3.2 remain open.

The source inventory also found a `loadCanonicalProof` call in `routes/ai/chat.ts` bound to a replay record, replay attempt, and candidate tree identity. It was inspected but not invoked; replay execution remains excluded.

### 2026-10-17 — accepted Project Query source handoff

Four focused `ai/missions.test.ts` cases passed across disposable loopback-only PostgreSQL clusters: preview accepts only the server-resolved `PROJECT_QUERY` source without creating durable work; a previously accepted source is rejected after the execution advances to a new attempt; handoff rejects a stale reviewed plan hash and persists provenance resolved from the accepted message, execution, acceptance, evidence snapshot, source revision, and claim refs; and a recovered assistant message that differs from the acceptance message is rejected.

Identity review confirmed one durable acceptance row per `(executionId, attempt)` through the database unique index. `loadCanonicalProof` locks the execution and exact-attempt acceptance, and `composeCanonicalProof` rejects an acceptance whose attempt differs from the locked execution. The route-level prior-attempt case passed 1/1; no additional acceptance-ID guard was justified by the inspected invariants.

The matching handoff fixture created only test Mission/Goal rows. Its auto-trigger selected a provider but skipped the execution claim because the test project root was unavailable; no worker or provider call ran. No replay, registration/approval action, production data, E4, or production code change was made. This covers the Project Query-to-Mission provenance boundary only; E3 and E3.2 remain open.

The remaining Mission projection callsite that loads proof for a stored skill candidate is read-only. Source inspection shows it includes the candidate only when the current Canonical Proof matches its acceptance ID, trajectory digest, source revision, and candidate-tree hash. It was not invoked; the available candidate unit tests construct Shadow Replay receipts, and candidate creation, replay, and registry routes remain outside this slice.

### 2026-10-17 — acceptance-attempt index validation failure, recorded before repair

A new `application-schema-check.test.ts` case modeled `uq_ai_execution_acceptances_execution_attempt` as a non-unique index with the expected name and columns. It failed because `findApplicationSchemaIssues` accepted that snapshot. The other 15 tests in that file passed. This establishes a schema-contract blind spot: the checker validated index identity/columns but not uniqueness, even though the Drizzle schema defines one acceptance per execution attempt.

The failure used only an in-memory schema snapshot; it did not inspect or mutate a live database and does not establish that any deployed index is non-unique or that duplicate acceptance rows exist. No production execution, provider, Replay, registration/approval, E4, or production data was involved.

Resolution: the application schema contract now marks the evidence-attempt, acceptance-attempt, and acceptance-finalization-key indexes as unique. Startup validation rejects missing `UNIQUE` or partial definitions for these indexes. The regression case now passes for both ordinary and partial unique indexes; the complete DB schema-check package passed 20/20. API typecheck passed, and the four Project Query handoff cases passed 4/4 again on a disposable loopback-only PostgreSQL cluster. The managed API workflow restarted and reached `Server listening` without a schema error, so its development database passed the strengthened schema check; no schema was applied to that database.

The managed API's normal startup refreshed the OpenRouter model catalog and reported three stale catalog entries; it made no model-generation request. No production database or Strategy Replay was used. This closes only the checked-index contract gap; E3 and E3.2 remain open.

### 2026-10-17 — stale execution snapshot proof projection failure, recorded before repair

A new `operation-evidence.integration.test.ts` case captured an execution at attempt 0, advanced its durable row to attempt 1, inserted a proven attempt-1 acceptance/evidence snapshot, then called `loadOperationEvidence` with the captured attempt-0 object. The assertion that the projection reject the newer proof failed: it returned `proof.accepted=true`. The other two integration cases were skipped in this focused run.

This establishes a stale-read identity mismatch in the Operation Evidence projection: the proof can refer to a newer durable attempt than the execution snapshot used for the rest of the projection. It does not establish a write, completion, or promotion bypass; the projection marks `verified: false` and this case invokes no decision handler. The test used only a disposable loopback PostgreSQL database; no provider, Replay, registry action, production data, or live project mutation was involved.

Resolution: `loadOperationEvidence` now supplies the captured execution attempt to `loadCanonicalProof`; a newer durable attempt therefore fails with `acceptance_attempt_mismatch` instead of appearing accepted inside the older operation snapshot. The unit and integration tests passed 7/7, API typecheck passed, and the managed API restarted to `Server listening` without a schema error. This corrects the Operation Evidence projection identity only; it does not establish a write-authority bypass or close E3/E3.2.

Source review found Operation Evidence is returned through chat, audit-export, and benchmark read projections; no server-side consumer uses its `releaseRecommendation` to authorize work. The projection keeps `verified: false`, and its current readiness call does not supply `terminalVerdict`, so it cannot report `releaseRecommendation: ready`.

### 2026-10-17 — remaining Canonical Proof and plan-review source inventory

A source-only inventory of production `loadCanonicalProof` callsites found no additional in-scope completion gate beyond the already reviewed Mission runtime/completion, acceptance finalizer, and Operation Evidence paths. Mission's stored skill-candidate views revalidate the candidate against a freshly loaded proof; the candidate route also requires the loaded acceptance ID to match its receipt. Replay-bound Mission and chat callsites recheck the exact replay attempt, active plan revision, acceptance identity, source revision, and candidate tree, but remain outside this audit slice and were not invoked.

The acceptance finalizer builds its execution proof projection after normalized evidence and snapshot creation, with the projection assignment after caller-supplied disposition fields. Episode closure is in the same transaction and is bound to the execution attempt, acceptance ID, source revision, and effect bundle. This source inspection did not establish a Mission-completion or promotion bypass; no test or runtime path was invoked for this observation.

Reviewed-plan flows for Mission creation and chat handoff recompute the preview and reject a mismatched submitted plan hash; the stale-hash route cases are already recorded above. Dashboard replan is a separate explicitly confirmed, server-owned action that sends only the Mission ID, not a reviewed preview hash. Its optional `expectedPlanHash` check is a no-op check against the newly generated plan, not a reviewed-plan concurrency token; this was not counted as a stale-preview guard failure.

Two focused Goal PATCH route tests passed on a fresh loopback-only temporary PostgreSQL cluster after applying the current schema there: edits roll back when completion has no Canonical Proof, and a `PROVEN` projection is rejected when its evidence snapshot belongs to another attempt. The run passed 2/2 selected tests; 41 other cases, including Replay cases, were skipped. Provider egress was disabled, and no development or production database was used.

The focused Mission runtime race case `blocks dependency release when the active plan revision rotates before authorization` also passed 1/1 on a separate loopback-only temporary PostgreSQL cluster. It verifies the continuation returns `stale_plan_revision` and leaves the Goal queued after the Mission's active revision changes under lock; 50 other cases were skipped.

This sweep established no new E3/E3.2 failure. It is source inventory only, does not qualify Replay or registry behavior, and does not close E3 or E3.2.
