# EngineeringOS Decision Intelligence — G6 Test Notes

## Initial outcome-evaluator fixture failure

The first G6 focused run reported **5 failed, 38 passed** across the focused set. All five new outcome-evaluation tests failed while parsing their shared strategy fixture: it used `validator_recovery`, which is not a supported `MissionStrategyAlternative.category`. The evaluator itself was not reached, so this failure provides no evidence about outcome-classification behavior. The pre-existing G2–G4 contract/generation/evaluation/replay tests remained **38/38 passing**, and AI-orchestrator typecheck passed. The fixture is being corrected to use a category defined by the current contract before rerunning.

## Rerun after fixture correction and safety tightening

After replacing the unsupported category with `verify_then_retry`, tightening effect-code extraction to explicit `effectCode`/`code` fields, allowing before observations to precede the final World State revision while requiring after observations to match it, and adding malformed-evidence coverage:

- AI-orchestrator typecheck: **passed**.
- G6 outcome evaluator and G2–G4 focused suites: **45 passed, 0 failed** (7 G6 tests plus 38 existing tests).
- The tests cover exact lifecycle and acceptance identity, direct fresh before/after effects, current after-state revision, proof binding, cross-attempt and cross-execution rejection, incomplete evidence, explicit contradictions, conflicting success/failure evidence, and malformed effect evidence returning `INCONCLUSIVE`.

These are pure evaluator tests. They do not prove a database adapter exists, that a canonical proof is independently reloaded for this evaluator, that an outcome record is persisted, or that the live Mission flow invokes it.

## Final whitespace check

`git diff --check` initially reported trailing spaces on five newly edited Markdown status lines used for visual line breaks. This was documentation formatting only; it did not affect code or tests. The spaces were removed before the final diff check.

The expanded whitespace scan, which also covers untracked files, found Markdown hard-break spaces in several newly added gate documents that the ordinary tracked-only `git diff --check` did not inspect. This is documentation formatting only; those lines are being converted to explicit paragraph/bullet formatting before the final scan.

## Plan-wide aggregation contract

The single-Execution evaluator was not widened to accept a successor Goal. Instead, a separate deterministic aggregator now accepts a server-resolved active plan projection and keeps the failed source Goal separate from successor Goals. It requires exact Goal/Task/Execution mappings, current plan and root dispatch references, per-Execution acceptance/effect/Canonical Proof references, and an independently verified final World State snapshot before `ACHIEVED` or `NOT_ACHIEVED`. Its content hash binds stable evidence while excluding evaluation time.

Latest verification:

- `pnpm --filter @workspace/ai-orchestrator exec vitest run src/agent-state/mission-strategy-outcome-evaluation.test.ts`: **15 passed, 0 failed**.
- `pnpm --filter @workspace/ai-orchestrator run typecheck`: **passed**.
- Cases include source-vs-successor Goal identity, partial Task state, unverified final World State, missing proof bindings, root-dispatch mismatch, persisted lifecycle-reference mismatch, achieved plan aggregation, and fully contradicted terminal outcome.

These tests remain synthetic. The aggregator does not load PostgreSQL, recalculate stored dispatch manifests, independently reload Canonical Proof, write an outcome record, or append lifecycle events. The live `EXECUTED` guard remains unchanged and must not be bypassed.

## Transactional Trace and snapshot-schema foundation

- The G5 Trace reader now exposes a transaction-scoped form and the public read uses one repeatable-read transaction so event hashes, sequence, and approval binding are checked from one database snapshot. The transaction is not marked read-only because approval validation takes row locks; the getter still performs no writes.
- An additive Drizzle definition for plan-outcome snapshots was typechecked as part of the API dependency build. A server-side insert-only writer now consumes it in the isolated test, but it is not applied to Development.
- The API-server typecheck completed successfully; the focused plan-outcome suite remains **15 passed, 0 failed**.
- No database integration test, schema push, lifecycle mutation, Mission execution, or external provider request was run.

This was groundwork only; the server adapter and database path are described below.

## Server-owned outcome snapshot integration

- The first isolated integration attempt failed **1/8** while 7 existing tests passed. It merged appended lifecycle events into the hashed canonical Trace; the schema correctly rejected the changed `decisionId`. This failure showed a contract mismatch, not a database or Mission failure.
- The fix leaves the canonical Trace unchanged and checks its initial `PROPOSED`/`EVALUATED`/`SELECTED` prefix against the independently validated durable lifecycle chain. `PLAN_APPLIED` and `DISPATCHED` references are accepted only from that chain and are cross-checked against the current plan and exact batch.
- The pure evaluator suite then passed **15/15**; API-server typecheck passed.
- The isolated Mission Trace suite passed **8/8** on a newly initialized loopback-only PostgreSQL cluster with the current Drizzle schema applied only to that cluster. The outcome case writes an `INCONCLUSIVE` snapshot for an unfinished dispatched execution, replays unchanged evidence idempotently, then changes the Goal and Execution to terminal failure without adding contradiction evidence. The finalizer remains `INCONCLUSIVE`, records a distinct snapshot for the changed evidence, and appends no `EXECUTED`/`ACCEPTED` lifecycle events.
- The first parallel launch of the isolated runner returned a tool-level `No process for id` error and left one empty temporary directory. Inspection found no server PID or listener; only that exact empty root was removed. The subsequent single-process run completed and stopped PostgreSQL cleanly.
- No `ACHIEVED` or `NOT_ACHIEVED` server-loader fixture, automatic reconciliation trigger, snapshot-consumer, Development migration, live Mission, or production change has been verified.

## Atomic outcome finalization and snapshot identity

- The first retry test failed **1/8** because it compared the complete persisted evaluation, including `evaluatedAt`; evidence identity intentionally excludes evaluation time. This was an idempotency-comparison defect, not a proof or database failure.
- The writer now compares the stable evaluation payload and returns the original stored evaluation on replay. Snapshot IDs bind the decision, evidence-set hash, and complete stable evaluation payload, excluding only `evaluatedAt`.
- `finalizeMissionPlanOutcome()` re-evaluates and persists within one serializable transaction. It appends the four plan-level lifecycle events only for `ACHIEVED`; `INCONCLUSIVE` and `NOT_ACHIEVED` do not advance the lifecycle. The generic batch append path still rejects a batch pointer as execution proof.
- Trace reads validate the outcome snapshot ID and its decision, plan revision, dispatch batch, manifest, and outcome bindings before accepting a plan-level lifecycle suffix.
- After the correction, API-server typecheck passed; the focused evaluator suite passed **15/15**; the isolated Mission Trace integration suite passed **8/8**. The integration fixture verifies an `INCONCLUSIVE` finalization, stable retry identity, and no lifecycle advancement.
- There is still no successful `ACHIEVED`/`NOT_ACHIEVED` database fixture or automatic reconciliation trigger. The snapshot schema remains unapplied to Development; no live Mission or production data was used.

G6 remains open until achieved and contradicted durable-row fixtures pass, the Development schema diff is reviewed before any migration, and a durable completion trigger invokes this finalizer without replaying side effects.
