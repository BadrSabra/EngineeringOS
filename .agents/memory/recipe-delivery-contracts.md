---
name: Recipe delivery contracts
description: Durable lessons from the Recipe API to verified external delivery path.
---

Recipe delivery capabilities must use the capability scope they advertise (`none` for GitHub delivery), and adapters must project shared-service results into their strict public output schema.

**Why:** The shared delivery service legitimately carries operational fields such as changed paths, while the capability contract intentionally exposes only the bounded recipe outputs. An empty approved-path list is not the same as a supported `paths` scope for an external integration.

Terminal recipe checkpoints must retain a direct recipe binding so idempotent replays compare stable operation identity without treating nested lease or phase fields as request identity.

**Why:** Completion finalization can otherwise leave only an operation-nested binding, causing a retry with the same idempotency key to be rejected even though the durable execution and receipt are already complete.

**How to apply:** When adding a server recipe, align its context scope, evidence type, capability output projection, terminal checkpoint binding, and replay test as one contract.

Mission recipe actions must resolve the managed project root and current Git revision at execution time; a candidate identity is usable only when it matches a server-owned validated/committed proposal, its base revision, and its durable delivery workspace.

**Why:** Goal actions are intentionally not trusted with roots, revisions, or workspaces. Binding those values at the worker boundary prevents stale or foreign candidate workspaces from becoming recipe evidence.

**How to apply:** Keep Goal/Mission dispatch as a coordinator over `runRecipeOperation`; use the durable execution and receipt as the execution identity, then project the terminal recipe result back to the Goal/Mission under a row lock.

Mission delivery binding is an explicit server-owned handoff: the UI may submit only a durable proposal ID, while the server verifies committed ownership and derives operation, repository, and branch identity.

**Why:** Allowing the browser or a model to provide delivery identity would let an otherwise valid Goal target a foreign, stale, or uncommitted change.

**How to apply:** Expose a dedicated binding action in Mission UI instead of asking users to edit `nextAction` JSON; refresh the Mission projection after the server accepts the binding.