---
name: Durable discovery materialization
description: Lifecycle and ownership rules for Git/archive discovery roots and upload directories
---

Rule: Git and archive discovery sources are copied into an app-managed durable child before scanning; adapter-owned temporary sources are cleaned afterward. Upload IDs are scoped to the authenticated owner for both lookup and cleanup, and stale-session GC retires an unimported session row before removing its managed root.

**Why:** temporary roots disappear across lifecycle events, an unscoped upload ID can expose another user's archive, and deleting a root before atomically retiring its session can race with import and remove a newly imported project.

**How to apply:** new discovery adapters should provide a materialization hook when their source is temporary, persist only the canonical managed root, and make filesystem cleanup conditional on an ownership/provenance check that cannot be forged by a path prefix.

Controlled discovery tests must respect the adapter's production URL policy; a
localhost smart-HTTP fixture cannot prove the GitHub-only repository path.

**Why:** A durable-clone test currently reaches the route boundary but is
rejected before cloning when it uses a local URL, so its expected 202/materialize
assertion is not evidence of a runtime regression.

**How to apply:** use an approved disposable remote or an explicit adapter seam
for materialization tests, and keep policy-rejection coverage separate from
async clone/import coverage.

Publish a discovery session's ready state only after adapter-owned temporary
source cleanup has completed.

**Why:** Consumers can import or inspect a ready session immediately; cleanup
performed only after the background job reports readiness creates a reachable
clone race under load.

**How to apply:** Put the pre-ready cleanup hook inside the discovery runner
and retain an idempotent outer finally cleanup as a last-resort safety net.