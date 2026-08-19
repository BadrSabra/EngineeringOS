---
name: Scan root fail-closed
description: Rules for handling persisted project roots at scan time and startup — never rebind, always fail closed.
---

**Rule:** Every scan re-establishes the persisted `root_path` through `establishProjectRoot` before any filesystem walk. If establishment fails (missing, not a directory, unreadable, unsafe), the scan fails with a `root_unavailable` outcome (`ScanRootUnavailableError`), leaving `root_path` and project state untouched. Startup reconciliation only *reports* dead legacy `/tmp/eos-git-*` roots — it never rewrites them.

**Why:** The old behavior silently rebound dead roots to `/home/runner/workspace`, causing scans to walk unrelated code and publish findings to the wrong project. Also, `/tmp/eos-git-*` is not a trust boundary — anyone can create such a directory, so the scan runner must not pass `allowManagedTempRoot` (it cannot verify discovery provenance from the projects row). Code review confirmed the unconditional exemption was a filesystem-boundary regression.

**How to apply:** Any new code path that reads a persisted project root before touching the filesystem must go through `establishProjectRoot` with default options and fail closed. Recovery from a dead root is user-driven re-import via discovery (which materializes to a durable workspace root), never automatic substitution. Tests for scan roots must create dirs under `/home/runner/workspace/.test-roots` because the workspace boundary is enforced when `REPLIT_DEV_DOMAIN` is set.
