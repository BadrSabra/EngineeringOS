---
name: Project root boundary
description: Durable policy for how filesystem paths may become project roots
---

Rule: a filesystem path may become a persisted project root only after canonical establishment (exists, readable directory, realpath, safety policy). A managed temp-dir path prefix is never provenance by itself — trust it only when the session's source type proves the server created it (Git adapter).

**Why:** the forensic audit showed client-supplied root strings and prefix trust let unrelated or system directories become scan roots; a completion review later caught that LOCAL_FOLDER sessions could forge the managed prefix.

**How to apply:** any new flow that persists or rebinds a project root must go through the shared establishment service and must gate temp-prefix allowances on real source provenance, not string matching. Apply the blocked-system-root policy independently of host environment markers, and re-check root/cwd identity immediately before spawning commands.
