---
name: GitHub delivery recovery
description: Proof required to distinguish an already-applied GitHub delivery from remote drift after a lost local receipt.
---

When a verified GitHub delivery loses its local receipt after the remote mutation, recovery may classify the remote effect as already applied only when the branch commit has the expected local commit tree SHA, exactly the expected verified parent, and the server-owned operation marker in the commit message. The canonical delivery-tree digest alone is not enough because it is not the GitHub tree object identity.

**Why:** A process can stop after GitHub updates the branch but before `GitPushed` is persisted. Retrying blindly can duplicate the external mutation, while accepting any changed branch can mistake unrelated remote work for the original operation.

**How to apply:** Keep the existing connector's parent drift fence. On a drift result, perform one bounded branch/commit inspection; record idempotent success only for the matching tree/parent/marker tuple. Any unavailable, divergent, or marker-less state remains blocked and requires reconciliation.

The ordinary user-requested Git push path is a separate contract from AI-scoped delivery: it may push the current local commit under project write access, while proposal-bound pushes must use the verified delivery service and its proposal/commit evidence gates.

**Why:** Manual pushes do not have an AI proposal or operation-owned commit evidence to validate, so forcing them through the proposal contract would either invent authority or break the existing Git settings flow.

**How to apply:** Route only proposal-bound GitHub pushes through `executeVerifiedGitHubDelivery`; keep manual pushes on the existing credentialed Git path until they receive a separately designed server-owned operation contract.