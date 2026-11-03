# EngineeringOS Decision Intelligence — Gate Status

This is the consolidated status for the G0–G10 plan. “Implemented” means only the stated code layer is present; it does not imply that a live Mission journey or measurable product improvement has been established.

| Gate | Current status | Evidence / remaining condition |
|---|---|---|
| G0 — Architecture audit | COMPLETE | `engineering-decision-intelligence-g0-audit.md`; source-path and gap findings are documented. |
| G1 — Baseline | BASELINE DEFINITION COMPLETE; improvement NOT MEASURABLE | `engineering-decision-intelligence-g1-baseline-v1.md`; no paired outcome data supports an improvement claim. |
| G2 — Decision contracts | COMPLETE | Shared schemas bind source execution/acceptance, attempts, revisions, alternatives, approval, and outcome record. |
| G3 — Strategy generation and differentiation | PARTIAL; THE LIVE ENGINE NOW RECORDS CANDIDATE PLAN PROJECTIONS | `artifacts/api-server/src/lib/mission-strategy-engine.ts` is called by `autoReplanMission()`. It now persists a bounded projection per candidate (ordered steps, dependencies, files, read-only/approval flags, and required observations), and runtime selection fails closed if fewer than two eligible projections differ. Tests cover the runtime ordering distinction and validator inspect-vs-analyze plans. The live engine still supports only runtime-start and validator recovery. The newer shared strategy contract/generator/comparer remains isolated. |
| G4 — Evaluation and selection | PARTIAL; LIMITED DETERMINISTIC SELECTION IS LIVE | The live engine compares two bounded candidates using fixed heuristic utility and deterministic tie-breaking. It is not the newer formal evaluator with 15 explicit dimensions, hard-constraint provenance, and typed `NO_DECISION`; neither selector has dispatch authority by itself. |
| G5 — Decision trace | PARTIAL; APPROVAL-REQUIRED DISPATCH RECOVERY WIRED | The store distinguishes the failed source Goal from successor plan Goals. For multi-root plans, a caller-owned transaction persists the exact root set, run statuses, and persisted Execution IDs, then appends `DISPATCHED` pointing to the manifest. The startup/persisted-job reconciler now finds applied-but-undispatched traces and revalidates the complete approval receipt, selected strategy, active Mission, and exact plan revision before invoking only dependency roots. It reloads each returned Execution by ID, project, Goal, and owner, then atomically records the batch and lifecycle event. If only some roots have Execution IDs, the durable batch is explicitly `partial`; no batch is recorded when none has one. The per-process 30-second cooldown is load shedding, not a distributed lease; correctness still depends on the existing Mission/Goal locks, task lifecycle claim, and recipe operation idempotency. Isolated tests prove all required approvals precede plan application, exact root/Execution binding, and no second dispatch after a durable batch. Development has the additive decision tables and checks, and the API restart on port 8080 is verified; a real Mission journey is not. A batch is provenance, not Canonical Proof; `EXECUTED`/`ACCEPTED` remain gated on a plan-wide outcome contract binding all relevant successor Goals/Tasks/Executions and acceptances. There is still no DB-level immutability enforcement. |
| G6 — Outcome evaluation | PARTIAL; PURE AGGREGATOR TESTED, SERVER LOADER OPEN | The original single-Execution evaluator remains isolated. A deterministic plan aggregator keeps the failed source Goal distinct from successor Goals, binds root dispatch, exact active Goal/Task/Execution sets, proof references, and a separate final World State snapshot. The Trace reader now supports transaction-scoped event-chain validation, and an additive snapshot-table definition exists in Drizzle; neither is connected to a server evidence loader, and the table is not applied to Development. Lifecycle advancement still rejects a root-batch pointer as plan completion. Verification remains synthetic; no live Mission outcome has been evaluated. |
| G7 — Shadow mode | NOT STARTED | Requires G5/G6 live read-only integration and a paired shadow record without plan or dispatch side effects. |
| G8 — Limited operation | NOT STARTED | Requires explicit approvals, proof-bound dispatch, bounded scope, and recovery/idempotency testing. |
| G9 — Demonstrated improvement | NOT MEASURABLE YET | Requires a paired baseline and accepted outcomes across a declared cohort. No success claim is supported. |
| G10 — Learning/generalization readiness | NOT STARTED | Requires held-out evidence and transfer checks; no unrestricted learning or automatic policy promotion. |

## Current verification boundary

- Latest G6 focused single- and plan-outcome suite: **15 passed, 0 failed**; AI-orchestrator typecheck passed. This is synthetic shared-library verification, not a database or Mission integration test.
- The previously recorded G2–G4/G6 combined suite (**45/45**) was not rerun after the plan-aggregation addition.
- G5 isolated Mission suite: **4 files / 32 tests passed** on a fresh temporary loopback-only PostgreSQL cluster; includes approval-required dispatch recovery, exact root/Execution identity, atomic batch/event persistence, and no repeat after a recorded batch.
- Runtime-start Canonical Proof integration: one attempt timed out at 20 seconds; the immediate isolated rerun passed (**1 passed, 36 skipped**) in 19.88 seconds. This is a near-limit timing risk, not proof of a live Mission journey; the timeout was not raised.
- API-server typecheck passed after the dispatch-recovery changes.
- Development `heliumdb`: four decision tables were applied through the scoped Drizzle path only after the full-schema preview showed unrelated existing-table/data-loss drift. `schema:check` passed; read-only inspection verified the expected keys/constraints/indexes. The pre-restart count of active applied-but-undispatched Mission revisions was **0**.
- The approved API workflow restarted and listens on port 8080. Startup logs show a free-model catalog refresh (not an inference), zero pending audit entries, and the durable dispatcher starting. A post-restart read-only Development query found **0** recent `DISPATCHED` events and **0** active applied-but-undispatched Missions; no Mission was dispatched by this check.
- No browser, GitHub operation, deployment, or real Mission journey was started. The isolated integration tests used only the disposable test database.
- Production was not targeted. Development schema changes are not evidence of production readiness.

## Next dependency-ordered work

1. G6 server-only loader for exact active-plan Goals/Tasks and acceptance-linked Executions, independently reloaded Canonical Proofs, effect/observation bindings, and a complete final World State snapshot; ambiguous mappings remain `INCONCLUSIVE`.
2. Review the additive snapshot schema diff against Development before applying it; then add an idempotent writer and transactionally revalidate the stored evidence manifest.
3. Only after that, permit plan-level `EXECUTED`/`ACCEPTED`/`VERIFIED` to reference the exact snapshot. A dispatch-batch pointer is never completion or proof.
4. G7 shadow-only comparisons, with an invariant test that plans, approvals, and dispatch are unchanged.
5. G8 only after explicit proof/approval and isolated recovery tests.
6. G9 and G10 only when measured accepted outcomes and held-out transfer evidence exist.
