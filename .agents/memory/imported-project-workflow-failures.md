---
name: Imported project workflow/DB failures
description: Why auto-created artifact workflows failed right after importing this project, and how it was fixed.
---

When artifacts are auto-registered for an imported project, the generated workflows can fail for two independent, easy-to-conflate reasons:

1. **`node_modules` missing** — the import didn't run `pnpm install`, so every workflow fails with `vite: not found` / `Cannot find package 'esbuild'`. Fix: `pnpm install` at the repo root, then restart the workflows.
2. **DB schema never pushed** — `lib/db` uses `drizzle-kit push` (see its `package.json` `push` script), not a migration-file system. A freshly provisioned Postgres has no tables, so API routes 500 with `relation "X" does not exist` even after `pnpm install` succeeds. Fix: `pnpm run push` (or `push-force`) inside `lib/db`.

**Why:** both failures look similar at a glance ("things are broken after import") but have unrelated root causes and unrelated fixes — always check workflow logs for the *specific* error class (missing binary vs. missing relation) rather than assuming a single fix addresses both.

**How to apply:** after importing or forking this project, always run `pnpm install` then `pnpm --filter @workspace/db run push` before trusting workflow failures to mean real application bugs.

3. **Stale process holding the port (`EADDRINUSE`) after a workflow restart** — restarting a workflow doesn't always kill a previous run's child process cleanly, especially right after adding new secrets/dependencies and restarting multiple times in a row. Symptom: workflow log shows `listen EADDRINUSE: address already in use 0.0.0.0:<port>` even though the workflow "restarted" successfully. Fix: find the PID via `lsof -i :<port>`, `kill -9 <pid>`, then restart the workflow again. `fuser` is not available in this environment.
