---
name: Project ownership/access-scope model
description: How ownership is enforced across all API routes — middleware pattern, helper function, and which files use which approach.
---

# Project Ownership / Access-Scope Model

## The Rule
Every route that touches project data must verify the caller owns the project before returning or mutating anything.

## Two Enforcement Patterns

### 1. `requireProjectAccess` / `requireProjectWriteAccess` middleware
For routes with `:projectId` in the URL path. Reads `req.params.projectId`, queries the DB, attaches `req.project` on success, or writes 404/403 and stops the chain. Defined in `middlewares/requireProjectAccess.ts`.

### 2. `loadProjectByIdForUser(projectId, userId, res)` helper
For routes where projectId comes from a query param or request body (not the URL path). Same 400/404/403 logic — returns the project row or `undefined` (caller must `if (!project) return;`). Also defined in `middlewares/requireProjectAccess.ts` as a named export.

**Why:** Express middleware only reads `req.params`, so non-path-param projectIds couldn't use the middleware pattern. The helper was added to cover tasks, rules, workflows, events, metrics, graph, and AI routes.

## Which Files Use Which Pattern

| File | Pattern |
|------|---------|
| routes/projects.ts | middleware (path param) |
| routes/discovery.ts | middleware (path param) on project routes |
| routes/tasks.ts | helper (projectId from query/body/task.projectId) |
| routes/rules.ts | helper (projectId from query/body/rule.projectId) |
| routes/workflows.ts | helper (projectId from query/body/workflow.projectId) |
| routes/events.ts | helper (projectId from query) |
| routes/metrics.ts | helper (projectId from query) |
| routes/graph.ts | helper (projectId from query/entity.projectId) |
| routes/ai.ts | middleware on analyze/review (path param), helper on chat/sessions/orchestrate/execute |

## Audit Calls
All `recordAudit(...)` calls should pass `actor: req.userId`. The audit.ts default is `"system"` — that's only for genuine system-initiated events (reconciliation, startup sweeps).

## 404 vs 403 convention
- Project not found → 404 (don't confirm existence to non-owners)
- Project found but wrong owner → 403
- projectId missing when required → 400
</content>
</invoke>