---
name: PR-D Workflow phase condition evaluation
description: Condition evaluation in the workflow advance endpoint — JS expression, safe context, 409/400 shape.
---

## What was done

`POST /workflows/:workflowId/advance` now evaluates an optional `condition` string on the current phase before advancing.

## Evaluation context

```ts
{ qualityScore: project.qualityScore ?? null, currentPhase: string, completedPhases: string[] }
```

`qualityScore` comes from `projectsTable.qualityScore` (real column, updated by scanner on each scan). No metrics table query needed — the project row carries the aggregated score.

## Response shapes

- Falsy result → `409 { error: "condition_not_met", condition, hint, context, blockers: ["condition_not_met: <expr>"] }`
- Syntax error → `400 { error: "condition_evaluation_error", condition, detail, hint }`
- No condition → advance freely (no change)

`blockers` intentionally mirrors the AI orchestrator's `wait` action shape so the dashboard can render both uniformly.

## Schema fix (same commit)

Added `ai_analyzed`, `ai_reviewed`, `ai_orchestrated`, `ai_auto_executed` to `auditActionEnum` in `lib/db/src/schema/audit_logs.ts`. These were referenced in `routes/ai.ts` but missing from the enum, causing typecheck failures. DB schema pushed.

## ai.ts fixes (same commit)

- Added missing `import { heavyJobQueue } from "../lib/job-queue.js"` (used by `scheduleAiTaskExecution` since PR-C but never imported)
- Removed unused `import type { PendingChange }` that was causing a TS6133 warning

## Dashboard

`PhaseInput` type gained `condition?: string`. Optional mono text input added below each phase's step list in the creation wizard. `cleanedPhases` omits `condition` when empty string.

## Tests

5 new tests in `workflows.test.ts`: condition not met (qualityScore), condition met, no condition (regression), syntax error (400), completedPhases array access.
