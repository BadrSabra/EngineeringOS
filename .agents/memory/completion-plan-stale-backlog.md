---
name: completion-plan.md backlog is stale
description: How to verify claims in docs/completion-plan.md's trailing backlog section against actual code state
---

`docs/completion-plan.md` (EngineeringOS project) is an actively-maintained, mostly-accurate
phase log (Phase 0 through at least Phase 12), but its trailing "Remaining open items" /
backlog section is not kept in sync with the phase entries above it.

**Confirmed stale claims found 2026-07-15:**
- "P0: no ownership checks on tasks/rules/workflows/graph routes" — false. Ownership
  enforcement (`requireProjectAccess`/`requireProjectWriteAccess`/`loadProjectByIdForUser`,
  400/404/403 convention) is already wired into every project-scoped route.
- "P0: missing tests on ai/events/rules/dashboard/health routes" — false. Test files for
  all five already exist and were added in the project's own "Phase 12" entry.

**Why:** the backlog text was written once and never pruned as later phases closed items,
so it silently drifts from what the phase log (and the code) actually say.

**How to apply:** before acting on any item in completion-plan.md's backlog/open-items
section, grep the actual route/middleware/test files first. Trust the code over the
backlog text; treat the phase-log entries above the backlog as higher-confidence than the
backlog itself.
