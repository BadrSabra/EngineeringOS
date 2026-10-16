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
| P0 | Goal dependency release | A dependency has `status=completed` but no accepted current-attempt proof, or its proof belongs to a prior plan revision/attempt. | Do not release or dispatch the dependent Goal as proven; return a bounded blocked/replan state. | Current code locks dependency edges, prerequisite Goals, and executions, then reloads Canonical Proof against the active plan revision. `mission-runtime.test.ts` includes a concurrent attempt-rotation race and fails closed. |
| P0 | Automatic Mission status aggregation | All selected Goal rows say `completed`, but one lacks current proof or is stale against the active plan. | Do not expose a proof-backed Mission completion; distinguish aggregate stored status from verified completion. | Aggregation uses `evaluateMissionCompletion`, which locks Mission/Goal rows and reloads proof per active Goal. The 2026-10-16 race fixture verifies a concurrent acceptance-attempt rotation results in `needs_replan`, not `completed`. |
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

Verification: an initial API fixture was stale (abbreviated pre-v2 receipt) and returned `BLOCKED / paired_baseline_missing` under manual policy; it never entered the apply handler. The fixture was rebuilt around a matching v2 receipt and current Canonical Proof. On an isolated loopback PostgreSQL database, the recovery-route group passed 15/15. A pair/run-ID mismatch under `eligible_auto_promote` returned `BLOCKED / paired_baseline_missing` before entering the handler. In the deterministic apply-time race, the trigger changes only `pairedBaseline.contract.sourceRevision` after the eligibility decision; the route reaches the real `applyChangesHandler`, which rechecks Gate 3 and returns 207 with `automaticPromotion=true`, `writeStatus=not_written`, and `paired_baseline_missing`. Assertions confirm the pair ID and run IDs still match, a `BLOCKED / automatic_promotion_policy` journal was recorded, the mocked validator was called once by the route and once by the handler, and the live tree hash and target file state remained unchanged. The real validation command was stubbed for this gate test. The existing Skill Registry route test contains actual registration/approval coverage, but it was not rerun or extended here. The existing Skill Registry unit test passed 11/11; API TypeScript and `git diff --check` passed.

Boundary: this verifies both the pre-handler promotion gate and the handler's secondary Gate 3 recheck under a controlled source-revision race. It does not prove a successful delivery write for a matching pair or test forged paired-baseline rejection at the Skill Registry route. E3 and E3.2 remain open; Strategy Replay receipts were not run, E4 was not started, and the managed API workflow was not restarted.
