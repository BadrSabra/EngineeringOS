---
name: Merge reconciliation volatility
description: Repository state can change while an active merge is being reconciled.
---

When a merge is active, treat the working tree, index, and HEAD as time-sensitive. Recheck `git status`, `MERGE_HEAD`, unmerged paths, and the target file immediately before and after conflict edits.

**Why:** In this project, a conflict and staged updates changed state during tool work; the branch advanced while the agent was validating. Editing against a stale view could overwrite a reconciliation or produce a misleading test result.

**How to apply:** Resolve only the confirmed conflicted path, preserve unrelated staged changes, avoid completing or pushing a merge unless explicitly requested, and rerun checks against the final bytes.
