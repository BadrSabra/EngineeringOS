---
name: Project root boundary
description: Durable policy for how filesystem paths may become project roots
---

Rule: a persisted project root must be canonically inside `/home/runner/workspace`, except for a managed Git temp root explicitly allowed by the server-owned Git discovery import. A temp-dir prefix alone is never provenance.

**Why:** accepting any non-system path left server-readable files outside the project workspace in scope; the forensic audit also showed client-supplied roots and prefix trust could bypass project boundaries.

**How to apply:** every project registration, local-folder discovery, and scan must use the shared establishment/policy boundary. Compare canonical paths by path segments, not string prefix. Keep the managed Git-temp exception restricted to verified Git provenance and apply the same policy regardless of host environment variables.

Root-establishment integration tests must use a fixture under an allowed project/workspace root; a real directory created directly under `/tmp` is still rejected as a project root.

**Why:** canonical realpath and existence do not override the blocked-system-root policy, so `/tmp` fixtures cannot exercise recovery that requires an admitted project root.

**How to apply:** place disposable project roots under the configured workspace, and remove only the unique fixture subtree during cleanup.

File access must not treat `safePath`/`realpath` as a read capability: open through a pinned project-root descriptor, verify the opened file or directory descriptor is still inside that root, then read or enumerate from the descriptor. Path-based consumers such as Git pathspecs need their remaining race stated explicitly.

**Why:** `realpath` followed by `open` leaves a check-then-use window where a parent path can be replaced with a symlink or different directory.

**How to apply:** use this boundary for source reads, search/navigation, manifests, binary inspection, and directory listings; keep mutation proposals approval-gated and do not claim a path-based consumer is inode-bound unless it actually is.
