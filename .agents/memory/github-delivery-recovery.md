---
name: GitHub delivery recovery
description: Proof required to distinguish an already-applied GitHub delivery from remote drift after a lost local receipt.
---

When a verified GitHub delivery loses its local receipt after the remote mutation, recovery may classify the remote effect as already applied only when the branch points to the exact server-approved local commit hash, with its expected Git tree SHA, exactly one expected verified parent, and the server-owned operation marker in the commit message. The canonical delivery-tree digest alone is not enough because it is not the GitHub tree object identity.

**Why:** A process can stop after GitHub updates the branch but before `GitPushed` is persisted. A different commit can have the same tree, parent, and marker; accepting it would mistake a distinct remote commit for the authorized operation.

**How to apply:** Keep the existing connector's parent drift fence. On a drift result, perform one bounded branch/commit inspection; record idempotent success only when the remote commit hash, tree, single parent, and marker all match the expected local operation. Any unavailable or divergent state remains blocked and requires reconciliation.

The ordinary user-requested Git push path is a separate contract from AI-scoped delivery: it may push the current local commit under project write access, while proposal-bound pushes must use the verified delivery service and its proposal/commit evidence gates.

**Why:** Manual pushes do not have an AI proposal or operation-owned commit evidence to validate, so forcing them through the proposal contract would either invent authority or break the existing Git settings flow.

**How to apply:** Route only proposal-bound GitHub pushes through `executeVerifiedGitHubDelivery`; keep manual pushes on the existing credentialed Git path until they receive a separately designed server-owned operation contract.

For the recipe-only World State projection, persist a direct remote-branch observation before a new push. Key the pending transition by execution and operation, then let a resumed attempt rebind its accepted effect and after-state while preserving the original before observation. If the exact delivered commit is already present, reconcile it without fabricating a new before-state; use the observed remote commit as the World State project revision.

**Why:** A remote branch mutation cannot be reconstructed from local workspace revision, and retries may change Episode attempt identity without changing the original pre-mutation fact.

**How to apply:** Keep this transition path inside `delivery.push.github`. Missing or uncertain remote state remains recoverable; manual pushes receive no synthetic execution, Episode, or transition identities.

For process-crash tests, exercise the production delivery service through a local HTTP fixture, acknowledge the branch `PATCH`, then hold the immediate post-push commit read and kill the child before it can write `GitPushed`. Do not gate the crash by locking the receipt insert: a receipt appeared after the killed client and later lock release in the test harness, which can be mistaken for startup recovery.

**Why:** Startup recovery must be distinguished from a database write that was already in flight when the client process died.

**How to apply:** Verify the remote ref advanced before killing the service, verify full API startup does or does not resolve the missing receipt, then exact-replay and duplicate-replay against the fixture. Keep this separate from live GitHub network tests.

For verified GitHub delivery, persist the operation-bound attempt identity before the first remote mutation. Startup must not resend the request or infer success from this intent: if there is no exact `GitPushed` receipt, it records `GitPushRecoveryRequired`. Only the normal verified delivery retry may resolve that marker after checking the exact commit, Git tree, single parent, and operation marker. Serialize startup reconciliation and receipt completion on the attempt row so a concurrent startup cannot leave a stale recovery marker after success.

**Why:** A durable pre-mutation intent closes the crash window without blind startup retries, while the shared row lock keeps concurrent startup and delivery completion from contradicting each other.

**How to apply:** Keep startup recovery decision-only and reuse the existing recovery event. Preserve exact remote verification in the service; never let the attempt event or the recovery marker act as delivery proof.

Concurrent delivery needs separate operation serialization and durable event uniqueness. Keep remote mutation and receipt finalization within an operation-scoped PostgreSQL session lock, but outside a database transaction that spans GitHub I/O. Use semantic partial uniqueness for attempts, receipts, and recovery markers; verified receipt uniqueness is keyed by the operation marker so manual Git events remain independent.

**Why:** Lookup-then-insert races can duplicate remote object creation, attempts, or receipts, while the shared events table also stores unrelated manual activity.

**How to apply:** Add concurrency protection only to the verified delivery path. Preserve the expected-parent fence, make receipt finalization idempotent, and avoid broad uniqueness on all correlated events.