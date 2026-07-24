---
name: RBAC archived write gate
description: requireProjectWriteAccess now enforces a real read/write distinction by rejecting mutations on archived projects.
---

The two middleware functions were identical aliases until this change. Now:
- `requireProjectAccess` — ownership check only; works on any status including archived
- `requireProjectWriteAccess` — ownership check + rejects `status === "archived"` with 403

**Why:** The four-phase gap analysis flagged the two functions being identical as a P0 RBAC gap. The first real distinction is the archived-project write gate; future expansions (collaborator roles) add to requireProjectWriteAccess only.

**How to apply:** Any route that mutates a project (PATCH, DELETE, /scan, /workflows, /tasks, etc.) must use requireProjectWriteAccess. Read-only routes (GET) use requireProjectAccess.

Test file: `artifacts/api-server/src/middlewares/requireProjectAccess.test.ts` (9 tests).
