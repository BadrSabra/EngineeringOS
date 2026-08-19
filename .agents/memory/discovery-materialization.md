---
name: Durable discovery materialization
description: Lifecycle and ownership rules for Git/archive discovery roots and upload directories
---

Rule: Git and archive discovery sources are copied into an app-managed durable child before scanning; adapter-owned temporary sources are cleaned afterward. Upload IDs are scoped to the authenticated owner for both lookup and cleanup, and stale-session GC retires an unimported session row before removing its managed root.

**Why:** temporary roots disappear across lifecycle events, an unscoped upload ID can expose another user's archive, and deleting a root before atomically retiring its session can race with import and remove a newly imported project.

**How to apply:** new discovery adapters should provide a materialization hook when their source is temporary, persist only the canonical managed root, and make filesystem cleanup conditional on an ownership/provenance check that cannot be forged by a path prefix.