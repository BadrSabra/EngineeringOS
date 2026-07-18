---
name: Gap analysis fixes batch-1
description: Nine implementation gaps fixed from the request-lifecycle trace analysis.
---

## G-01 — Task priority query (context-builder.ts)
DB query now sorts by `priority ASC, updatedAt DESC` directly, LIMIT 10.
The old pattern (LIMIT 50 by updatedAt, then in-memory re-sort) cut P0 tasks with old timestamps before the sort ran.
**Why:** `priority` column values ('p0'..'p3') sort correctly lexically ascending.

## G-02 + G-14 — Missing events for apply/commit/push
- apply-changes (routes/ai.ts): inserts `AiChangesApplied` event after writing files.
- git commit (routes/git.ts): inserts `GitCommitCreated` event.
- git push (routes/git.ts): inserts `GitPushed` event.
**Why:** These operations were audit-log only; the eventsTable (read by AI context recentEvents and the dashboard feed) was never updated.

## G-03 — Post-push scan trigger (routes/git.ts)
After a successful push, `setImmediate` fires a fire-and-forget scan: inserts into `scanJobsTable`, updates project status to "scanning", emits `ProjectScanQueued` event, enqueues via `heavyJobQueue`.
Imports needed: `eventsTable`, `scanJobsTable` from `@workspace/db`; `runScanJob` from `../lib/scan-runner.js`; `heavyJobQueue` from `../lib/job-queue.js`.
**Why:** Without this the graph/metrics are permanently stale after a push until the user manually clicks Scan.

## G-04 — Apply race with concurrent chat (AiChat.tsx)
Textarea and send button now include `|| applyMutation.isPending` in their `disabled` condition. Placeholder text changes to "Applying changes… please wait" during apply.
**Why:** User could race a new AI message while files were still being written, causing context/disk state inconsistency.

## G-05 — No git-status invalidation after apply (AiChat.tsx)
`applyMutation.onSuccess` now calls `qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] })`.
**Why:** GitPanel showed no dirty markers after AI applied files until a manual refresh.

## G-06 — localStorage ghost state (AiChat.tsx)
Storage format changed from `PendingChange[]` to `{ changes: PendingChange[], savedAt: number }`.
On load, entries older than 24 hours are expired and removed.
Old format (plain array) is handled for backward compat (`savedAt` defaults to 0, which always expires).
**Why:** If the tab crashes between server write and onSuccess, the changes remained in localStorage forever as phantom pending items.

## G-09 — Silent pendingChanges drop (chat-agent.ts)
On `ChatOutputSchema.safeParse` failure, instead of returning `pendingChanges: []`, the code now filters to keep changes that satisfy the minimum structural contract (path, absolutePath, newContent, reason all non-empty strings).
**Why:** A Zod schema validation failure was silently discarding ALL file-write intent, even when individual changes were structurally valid.

## G-15 — Generated-file write guard (file-tools.ts)
`write_file` tool now checks path against `GENERATED_PATTERNS` (matches `/generated/`, `/__generated__/`, `/.generated/`, `*.gen.ts`, `*.generated.ts` etc.) and returns an error message directing the model to edit the source instead.
**Why:** The prompt instruction "never edit auto-generated files" had zero code enforcement.

## Pre-existing Tasks.tsx type errors (also fixed)
`setFilterStatus` and `setFilterPriority` onChange handlers now cast `e.target.value` with `as TaskStatusFilter | ''` and `as TaskPriorityFilter | ''`.
