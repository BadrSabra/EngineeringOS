---
name: GitHub delivery recovery
description: Proof required to distinguish an already-applied GitHub delivery from remote drift after a lost local receipt.
---

When a verified GitHub delivery loses its local receipt after the remote mutation, recovery may classify the remote effect as already applied only when the branch commit has the expected local commit tree SHA, exactly the expected verified parent, and the server-owned operation marker in the commit message. The canonical delivery-tree digest alone is not enough because it is not the GitHub tree object identity.

**Why:** A process can stop after GitHub updates the branch but before `GitPushed` is persisted. Retrying blindly can duplicate the external mutation, while accepting any changed branch can mistake unrelated remote work for the original operation.

**How to apply:** Keep the existing connector's parent drift fence. On a drift result, perform one bounded branch/commit inspection; record idempotent success only for the matching tree/parent/marker tuple. Any unavailable, divergent, or marker-less state remains blocked and requires reconciliation.