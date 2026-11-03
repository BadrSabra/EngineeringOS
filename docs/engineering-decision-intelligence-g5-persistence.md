# EngineeringOS Decision Intelligence — G5 Durable Trace

## Gate status

- **G5 storage layer: IMPLEMENTED AND VERIFIED on a disposable local PostgreSQL database.**
**G5 live Mission integration: OPEN.** The current selector, plan mutation, and dispatcher do not yet call this store.

G5 is not an overall product-completion claim. The API package currently has a durable trace-storage contract with explicit identity checks and lifecycle events; the runtime does not yet produce and consume those traces.

## Why a separate trace record is needed

The G0 audit found that existing Mission plan snapshots and execution/acceptance/effect/replay records do not retain a single record of the alternatives considered, their evaluations, the selected or no-decision result, and the revisions that framed the decision. G2 therefore established a bounded decision trace contract, and G5 adds two additive tables rather than overloading a Mission plan snapshot or treating a replay candidate as a live decision.

## Persisted records

- `ai_mission_decision_traces` stores the validated decision JSON and identity columns for project, Mission, Goal, source Execution/attempt, source Acceptance, prior plan revision, project revision, World State revision, environment revision, context hash, result, and creation time.
- `ai_mission_decision_events` stores ordered lifecycle pointers with deterministic event IDs and hashes. The lifecycle supports `PROPOSED → EVALUATED → SELECTED → APPROVED (when required) → PLAN_APPLIED → DISPATCHED → EXECUTED → ACCEPTED → VERIFIED → EVALUATED_AFTER_EXECUTION`.
- A selected decision may not record `DISPATCHED` until `PLAN_APPLIED` verifies the current Mission/Goal plan revision changed from the prior revision and both Goal plan projections agree.
- `DISPATCHED` must reference a different Execution for the same project and Goal. `EXECUTED` must retain that Execution identity. `ACCEPTED` must reference an Acceptance for that Execution and exact attempt.
- Decision IDs are content hashes. Repeated persistence of the same ID is idempotent only when the persisted context/result identity matches. Event IDs are deterministic per decision/stage; stage sequence is unique and monotonic.

## Server-side revalidation

The store locks Mission and Goal before source Execution and source Acceptance, then checks project/Mission/Goal relations, source execution and attempt, source acceptance, the current plan revision, project revision, and current World State revision when supplied. Eligible supported evidence references are resolved against their persisted rows and scope. Eligible evidence kinds without a server-owned resolver fail closed instead of being trusted from caller-supplied JSON.

The evidence references and lifecycle references are still **provenance**, not proof. They do not grant approval, authorize dispatch, satisfy a validation gate, prove a delivered artifact, or replace Canonical Proof.

## Verification

See `docs/engineering-decision-intelligence-g5-test-notes.md` for the failure-first record and exact test history. The final isolated run used PostgreSQL 16.10 under `/tmp`, applied the current Drizzle schema to a fresh temporary database, and passed all four G5 integration tests. The test command stopped the exact cluster and removed its temporary root. No Development or Production data was touched.

## Explicit non-claims and next work

1. No live Mission selector, plan-update handler, or dispatcher currently emits/consumes these records.
2. Validation-session, capability, approval, and historical-outcome eligible refs remain unsupported until a server-side resolver exists.
3. Immutability is enforced by the storage API shape and content-hash verification on reads, not by a DB trigger or restricted role. Direct SQL UPDATE/DELETE remains outside this service's guarantee.
4. A later Goal replan does not invalidate historical `PLAN_APPLIED` pointers; read-time integrity is the event hash/order, while append-time validation checks the plan was current when applied.
5. G6 now has a pure deterministic evaluator, but its server-side evidence loader, Canonical Proof revalidation, durable outcome record, and live Mission integration are still open. See `docs/engineering-decision-intelligence-g6-outcome-evaluation.md`.
