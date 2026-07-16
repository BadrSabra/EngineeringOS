---
name: Dashboard scoping PR-01
description: How the dashboard route was scoped to owner and what guard patterns are needed.
---

# Dashboard scoping — PR-01

## Rule
Every table read in dashboard.ts must be filtered by `ownerId = userId` (for projectsTable) or `projectId IN user_project_ids` (for tasks/events/metrics). Global rules (`projectId IS NULL`) are always shown to any authenticated user.

**Why:** dashboard.ts was reading all rows from all tables with no ownership filter — any authenticated user could see every other user's project data through the dashboard summary.

## How to apply
- Always add `requireAuth` before any route that reads per-user data.
- Load user's projects first: `WHERE ownerId = userId`.
- Derive `projectIds` array from those projects.
- Gate every subsequent `inArray(table.projectId, projectIds)` behind `if (projectIds.length > 0)` — drizzle-orm's `inArray` throws on an empty array.
- For tables with optional projectId (e.g. rulesTable), use `or(isNull(...), inArray(...))` to include global rows alongside scoped ones.

## Test pattern
Tests run as "test-user" (requireAuth bypass in NODE_ENV=test). Isolation tests insert rows with `ownerId: "other-user"` and assert those rows are absent from the response. This proves the scoping contract without needing a real Clerk session.

## Files changed
- `artifacts/api-server/src/routes/dashboard.ts` — full rewrite with owner scoping + requireAuth
- `artifacts/api-server/src/routes/dashboard.test.ts` — 7 isolation tests added (18 total, all pass)
