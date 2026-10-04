---
name: Project root boundary
description: Durable policy for how filesystem paths may become project roots
---

Rule: a filesystem path may become a persisted project root only after canonical establishment (exists, readable directory, realpath, safety policy). A managed temp-dir path prefix is never provenance by itself — trust it only when the session's source type proves the server created it (Git adapter).

**Why:** the forensic audit showed client-supplied root strings and prefix trust let unrelated or system directories become scan roots; a completion review later caught that LOCAL_FOLDER sessions could forge the managed prefix.

**How to apply:** any new flow that persists or rebinds a project root must go through the shared establishment service and must gate temp-prefix allowances on real source provenance, not string matching. Apply the blocked-system-root policy independently of host environment markers, and re-check root/cwd identity immediately before spawning commands.

Root-establishment integration tests must use a fixture under an allowed project/workspace root; a real directory created directly under `/tmp` is still rejected as a project root.

**Why:** canonical realpath and existence do not override the blocked-system-root policy, so `/tmp` fixtures cannot exercise recovery that requires an admitted project root.

**How to apply:** place disposable project roots under the configured workspace, and remove only the unique fixture subtree during cleanup.

File access must not treat `safePath`/`realpath` as a read capability: open through a pinned project-root descriptor, verify the opened file or directory descriptor is still inside that root, then read or enumerate from the descriptor. Path-based consumers such as Git pathspecs need their remaining race stated explicitly.

**Why:** `realpath` followed by `open` leaves a check-then-use window where a parent path can be replaced with a symlink or different directory.

**How to apply:** use this boundary for source reads, search/navigation, manifests, binary inspection, and directory listings; keep mutation proposals approval-gated and do not claim a path-based consumer is inode-bound unless it actually is.
