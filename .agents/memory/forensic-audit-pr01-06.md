---
name: Forensic audit PR-01–06 (batch 2)
description: Six audit findings fixed in one session — evaluator, stale-job sweep, service extraction, metric rename, rootpath helper, CI gate
---

## PR-01 — new Function → safe evaluator
- `artifacts/api-server/src/lib/condition-evaluator.ts`: full recursive-descent parser for the 3 allowed variables
- Throws `EvalError` (not `Error`) on constraint violations → callers return HTTP 400
- `workflows.ts` uses `checkAdvanceCondition` from `services/workflow-service.ts`

## PR-02 — stale running-job sweep
- `failStaleRunningJobs` exported from `job-reconciliation.ts` — finds scan jobs in "running" > STALE_JOB_TIMEOUT_MS (default 2h)
- `startStaleJobSweep` returns a `NodeJS.Timeout` interval (default 30m)
- Called from `index.ts` inside the `app.listen` callback (after binding)
- Startup reconciliation (crash recovery) already fails ALL running jobs; sweep covers hung-but-not-crashed case

## PR-03 — service extraction
- `services/task-service.ts`: `runTaskVerification(task, projectRootPath)` → `VerificationOutcome`; 3 branches (rule pattern, related files, neither)
- `services/workflow-service.ts`: `checkAdvanceCondition`, `computePhaseAdvancement`; uses condition-evaluator
- `tasks.ts` lost ~73 lines, `workflows.ts` lost ~50 lines

## PR-04 — testCoverage → structuralTestEstimate
- TS field renamed in: `ComputedMetrics` interface, return object, DB schema alias comment
- DB column `test_coverage` unchanged — Drizzle `.alias()` pattern, NO migration needed
- Touch points: `metrics-calc.ts`, `lib/db/src/schema/metrics.ts`, `context-builder.ts`, `dashboard/Metrics.tsx`, `metrics-calc.test.ts`, `scan-runner.ts` (maps to DB column)

**Why:** The old name implied it was measured branch/line coverage. It is a file-ratio heuristic.

## PR-05 — rootpath-validator
- `artifacts/api-server/src/lib/rootpath-validator.ts`: `resolveRootPath(storedRootPath, projectId) → RootPathResult`
- Uses `logger.warn` not `console.warn`; returns `{ validRootPath, fallbackUsed, originalPath }`
- Two call sites in `ai.ts` (chat handler + SSE handler) both reduced to one line

## PR-06 — CI gate
- `.github/workflows/ci.yml`: checkout → pnpm → node → install → codegen:check → typecheck → test
- Root `package.json` `validate` script: `pnpm codegen:check && pnpm typecheck`
