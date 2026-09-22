---
name: Recipe delivery contracts
description: Durable lessons from the Recipe API to verified external delivery path.
---

Recipe delivery capabilities must use the capability scope they advertise (`none` for GitHub delivery), and adapters must project shared-service results into their strict public output schema.

**Why:** The shared delivery service legitimately carries operational fields such as changed paths, while the capability contract intentionally exposes only the bounded recipe outputs. An empty approved-path list is not the same as a supported `paths` scope for an external integration.

Terminal recipe checkpoints must retain a direct recipe binding so idempotent replays compare stable operation identity without treating nested lease or phase fields as request identity.

**Why:** Completion finalization can otherwise leave only an operation-nested binding, causing a retry with the same idempotency key to be rejected even though the durable execution and receipt are already complete.

**How to apply:** When adding a server recipe, align its context scope, evidence type, capability output projection, terminal checkpoint binding, and replay test as one contract.