---
name: Local review worktree ownership
description: Keep persistent Git review branches separate from delivery workspaces while preserving pinned, no-follow writes.
---

A Git review worktree is not an operation-owned delivery workspace. Keep delivery workspace writes restricted to their fixed path and marker. For review branch overlays, bind writes to the review operation directory, its exact preparation manifest, and the project path under the worktree; retain pinned directory-descriptor writes and no-follow checks.

**Why:** The delivery writer correctly refused the Git worktree path, making review branch creation fail. Relaxing that writer would have removed an important ownership boundary.

**How to apply:** Give each persistent candidate type its own server-owned marker and safe writer rather than broadening the delivery writer. Test successful creation as well as tampered-marker and symlink behavior.
