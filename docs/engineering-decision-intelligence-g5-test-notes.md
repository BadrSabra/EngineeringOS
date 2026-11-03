# EngineeringOS Decision Intelligence — G5 Test Notes

## First validation after requiring recovery acceptance identity

The shared focused run reported **35 passed and 3 failed**. The three failures were all in G3 generation fixtures: those recovery contexts supplied execution/attempt/plan identity but omitted the source acceptance identity required by the tightened G2 contract. No G3 runtime algorithm assertion failed; schema parsing stopped before proposal generation. The API Mission strategy-engine suite passed **5/5**.

The API typecheck separately stopped on one unused local type alias in the new G5 store. This is a compile hygiene issue, not a schema/storage behavior failure.

These findings are recorded before fixture/type cleanup. No database, provider, API workflow, browser, or Mission execution was started.

## First isolated PostgreSQL G5 run

`schema:apply` succeeded against a newly initialized PostgreSQL 16.10 cluster under `/tmp`. The three new storage integration tests all failed while constructing the test trace, before invoking any storage operation: the fixture added `evidenceIds` and `confidence` to the identity object, but the contract does not allow those fields there. The incorrect shape also made the computed context hash disagree with the parsed context. Therefore, this run verifies only that the additive Drizzle schema can be applied to a fresh disposable database; it does **not** verify the store's inserts, idempotency, stale-plan rejection, or event behavior.

## G5 reader integrity-check type failure

The next API package typecheck reported **1 TypeScript error**: the lifecycle reader validated a deterministic event ID, but its select projection omitted the `id` column. G2–G4 focused tests still passed **38/38**. This is an incomplete read projection, not evidence of a persisted-data defect. The fix is to include the ID in the selected event projection and return type before the database test.

## Plan-applied lifecycle extension type failure

After adding an explicit `PLAN_APPLIED` lifecycle event so the trace can bind a selected decision to the Goal's new plan revision before dispatch, API typecheck reported **7 TypeScript errors**: four fixture issues (one unused import and a readonly tuple), and three generated-stage-union errors because the lifecycle schema's stage enum had not been updated consistently. G2–G4 focused tests remained **38/38 passing**. The failure is recorded before resolving the contract and fixture type drift.

After adding the missing contract stage and removing the unused/readonly fixture fields, API typecheck reported **1 remaining error**: the difference fixture widened `changedDimensions` to `string[]` instead of the contract's dimension union. The shared G2–G4 suite remained **38/38 passing**. This is recorded before narrowing the fixture to the schema type.

## Isolated PostgreSQL verification after corrections

The final G5 run created a fresh PostgreSQL 16.10 cluster under `/tmp`, applied the complete current Drizzle schema using `pnpm --filter @workspace/db run schema:apply`, and then ran the focused API integration file:

- Schema apply and the repository schema check: **passed** on the disposable database.
- G5 integration: **4 passed, 0 failed**.
- Covered invariants: concurrent duplicate persistence yields one insert and one idempotent replay; the persisted source links resolve to the same project/Mission/Goal/Execution/Acceptance attempt; a stale Goal plan is rejected; `NO_DECISION` cannot progress; a selected trace cannot dispatch before a changed current Goal plan is observed and recorded as `PLAN_APPLIED`.
- API and AI-orchestrator typechecks: **passed**.
- G2–G4 focused suites: **38 passed, 0 failed**.

The temporary PostgreSQL server was stopped and its exact `/tmp` root removed by the test command's cleanup trap. Development and Production were not queried or modified.

## Remaining G5 boundaries

The persistence service revalidates eligible acceptance, execution, world fact, world transition, observation, episode, effect, and current-plan references. Eligible evidence kinds without a server-side resolver (including validation sessions, capability declarations, approvals, and historical outcomes) fail closed. Event references are provenance pointers, not proof or authorization. `PLAN_APPLIED` is checked against the current Mission/Goal rows when appended; historical reads validate the event hash and sequence without requiring the Goal to remain on that old plan.

The service exposes insert/append operations and does not update stored traces. However, the Drizzle schema does not install database triggers or restrictive database grants that prevent direct SQL UPDATE/DELETE by a database principal. Therefore the trace is application-level insert/append-only, not tamper-proof against a direct database writer. No live Mission selector or dispatch caller uses this store yet; G5 is **storage-layer verified, live integration open**.
