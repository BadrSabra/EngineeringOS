---
name: PR-C AI auto-trigger
description: How the AI auto-trigger on verifying state was wired — scheduleAiTaskExecution already existed, just needed import + two call sites.
---

## What was done

`scheduleAiTaskExecution` was already fully implemented and exported from `artifacts/api-server/src/routes/ai.ts` (line 1066). PR-C was purely a wiring change in `tasks.ts`.

## Two trigger points

1. **POST /tasks/:taskId/execute** — after `recordAudit`, before `return res.status(202).json(updated)`:
   - fires when `finalStatus === "verifying" && task[0].prompt` is non-null

2. **PATCH /tasks/:taskId** — after the event emission, before `return res.json(updated[0])`:
   - fires when `body.status === "verifying" && updated[0].prompt` is non-null

## Import

`import { scheduleAiTaskExecution } from "./ai.js";` added to `tasks.ts` — no circular dependency (ai.ts imports `tasksTable` the DB table, not the route module).

## Tests (5 new, vi.mock pattern)

Used `vi.hoisted` + `vi.mock("./ai.js", async importOriginal => ({ ...actual, scheduleAiTaskExecution: mockFn }))` to spy without breaking the real AI router mount.

**Why:** `importOriginal` spread keeps the default router export intact so `app.ts` → `routes/index.ts` → `ai.ts` mount still works in integration tests.

## Pre-existing bug fixed

Two discovery test assertions used `/not yet available/i` but the actual error message says "not available in this deployment" — updated to `/not available/i`.
