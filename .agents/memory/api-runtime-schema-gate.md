---
name: API runtime schema gate
description: Environment constraint affecting API startup and integration validation
---

The API artifact can compile and bundle successfully while refusing to start, or while integration fixtures fail during request setup, when the database schema is behind the current Drizzle definitions.

**Why:** The server performs fail-fast schema checks and the integration suite creates durable execution rows before reaching route behavior, so missing tables or columns mask application-level regressions.

**How to apply:** Treat missing-schema errors as a validation prerequisite and do not apply migrations as part of an unrelated feature task without explicit scope and consent.

For process-recovery tests, avoid holding `ACCESS EXCLUSIVE` locks on application tables before `src/index.ts` reaches reconciliation. Its `information_schema.columns` contract probe can wait on those relation locks, making a child-process kill look like a reconciliation pause when recovery has not started. Hold row locks on the exact stale task/execution fixture rows instead, then wait for the corresponding reconciliation `UPDATE`.

**Why:** A table-wide startup barrier was observed blocking the schema probe before `reconcileStuckJobs`; row-level locks let that probe finish and isolate the recovery write boundary.

**How to apply:** When testing startup recovery, seed the stale rows, lock only those rows in a separate transaction, and confirm `pg_stat_activity` shows the expected task/execution `UPDATE` waiting before sending `SIGKILL`.