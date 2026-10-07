# E3 Forensic Entry Audit

**Date:** 2026-10-05
**Status:** Entry audit recorded; E3 implementation has not started. E3.2 replay safety remains OPEN.
**E2 boundary:** Closed for proof-bound World State materialization as defined in the current project decision.

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
| P0 | Goal dependency release | A dependency has `status=completed` but no accepted current-attempt proof, or its proof belongs to a prior plan revision/attempt. | Do not release or dispatch the dependent Goal as proven; return a bounded blocked/replan state. | `loadGoalDependencyState` selects dependency IDs and statuses only (`mission-runtime.ts:115-147`); `runMissionGoal` checks terminal Goal/Mission status and releases dependencies based on `status === "completed"` (`:1297-1347`). This is a decision-boundary gap requiring a proof-freshness contract and regression tests. |
| P0 | Automatic Mission status aggregation | All selected Goal rows say `completed`, but one lacks current proof or is stale against the active plan. | Do not expose a proof-backed Mission completion; distinguish aggregate stored status from verified completion. | `deriveMissionStatusFromGoals` derives `completed` from Goal statuses only (`ai-execution-acceptance.ts:532-554`). Existing findings report automatic Mission aggregation does not reload proof for every Goal. Individual writers are guarded, so this is a freshness/aggregation gap rather than a demonstrated normal writer bypass. |
| P1 | Mission/Goal API and dashboard projections | A historical `completed` status is returned after acceptance, attempt, or plan proof becomes unavailable/stale. | Keep the value explicitly status-only or return a proof freshness/verdict; never label it Canonical `PROVEN`. | Existing forensic audit finds several read projections expose stored statuses without reloading Canonical Proof. This is a presentation/consumer boundary, not itself an acceptance writer. |
| P1 | Shadow Replay receipt reads and idempotent replay | Receipt refers to an old replay attempt or missing/stale acceptance/evidence. | A stored receipt may be displayed as historical metadata but must not authorize registration, approval, or promotion; decision gates reload source and replay proof. | Existing audit reports decision gates revalidate proof, while some GET/idempotent response paths can return stored receipt data without reloading the replay proof. Positive recovery and crash-boundary coverage is incomplete. |
| P1 | Workflow intermediate phase | `evidenceComplete` is true while required evidence/Canonical Proof is absent. | No `PROVEN` acceptance or terminal Goal/Mission completion. | Existing audit found a theoretical intermediate projection from `evidenceComplete`; the production caller currently fails closed at operation acceptance. Retain a regression guard; do not mistake a mocked helper test for production reachability. |
| P2 | Delegated-child proof aggregation | Parent lineage exists but no server-owned required-child contract binds the required children to the parent acceptance. | Keep the helper unused; lineage alone must not establish parent proof. | Existing audit found the aggregation helper has no production caller and lacks a required-child contract. This is an unimplemented capability, not a current production bypass. |
| P2 | Task status and Task verification | A Task is completed/verified while its linked Goal/Mission proof is incomplete. | Preserve Task-local semantics and labels; never promote Task status into Goal/Mission Canonical Proof. | Existing audits show Task API verification is task-scoped and does not accept the linked Goal or Mission. Verify UI wording remains distinct. |

## Entry decision

1. Treat dependency release and automatic Mission completion aggregation as the first decision-authority surfaces to resolve.
2. Keep read projections, replay receipts, and Task-local status in the matrix as separate freshness/presentation contracts.
3. Preserve the distinction between a demonstrated production bypass, a status-only read surface, and a currently unreachable/helper-only path.
4. Before implementation, define how a historical proof can or cannot satisfy a dependency on a newer plan revision, then add fail-closed integration fixtures for prior attempt, missing acceptance, stale plan revision, and missing evidence.
5. Do not combine this E3 work with E4 World Delta expansion or any Learning/Transfer/Generalization activation.

This is an entry audit, not an E3 closure. The next implementation slice requires an explicit scope decision based on the failure matrix.

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

The result must be a bounded block/replan or a decision based on freshly revalidated state. The test must exercise the production transaction/lock or compare-and-set boundary; a helper-only mock does not establish race safety. Add missing-proof, prior-attempt, stale-revision, and incomplete-evidence cases independently, and keep crash/replay receipt recovery as its own contract.

This is a proposed E3 acceptance contract only. Do not expand it into World Delta work, a new universal authorization service, or Learning/Transfer/Generalization.
