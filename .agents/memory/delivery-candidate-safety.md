---
name: Delivery candidate safety
description: Durable candidate workspaces must handle symlink roots, cross-filesystem copies, and symlink-safe overlays.
---

Candidate delivery roots may be symlink aliases, and the managed candidate directory may be on a different filesystem from `/tmp`. Resolve the source directory before hashing/copying, use a copy fallback instead of cross-device rename, and reject symlink traversal before writing candidate bytes.

**Why:** Imported projects and test fixtures can use symlink roots; assuming a real directory or same-device rename turns safe candidate preparation into a runtime failure, while following a candidate symlink can write outside the isolated workspace.

**How to apply:** Keep candidate hashing, cloning, and every overlay write behind the delivery-workspace safety helpers. Preserve symlinks for digest evidence, but never follow them for writes.