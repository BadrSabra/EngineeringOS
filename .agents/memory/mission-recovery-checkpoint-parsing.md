---
name: Mission recovery checkpoint parsing
description: Preserve nested Mission tool-loop manifests when reloading durable execution checkpoints.
---

Parse Mission tool-loop recovery state from the full persisted checkpoint envelope, not from the general `parseAiExecutionCheckpoint` projection. That projection intentionally bounds its human-readable `detail` field, while Mission's serialized tool-loop state and recovery manifest are nested in that field and may exceed the limit. The raw-envelope parser must still validate the wrapper stage, sequence, and timestamp, then let the inner parser validate the complete schema, hashes, and identities. Do not widen the general checkpoint projection just to support Mission recovery.

**Why:** A valid persisted `candidate_ready` manifest was being truncated before Mission recovery parsed it, converting an eligible same-attempt resume into a fail-closed invalid checkpoint.

**How to apply:** When adding recovery data inside a checkpoint detail, follow the raw persisted representation from database read through the domain parser. Keep the ordinary projection bounded, and ensure malformed or mismatched raw state remains non-resumable.

Startup reconciliation must preserve the original `tool_loop` detail when it rewrites execution state. Reuse the raw detail only when the wrapper stage, sequence, and timestamp match the validated projection and the detail remains within the recovery size bound; otherwise leave the checkpoint untouched rather than serializing the bounded projection over it.

**Why:** Reconciliation previously truncated the nested Mission manifest before the Mission parser ran, even though the original persisted checkpoint was valid.

**How to apply:** Any startup or retry path that updates a checkpoint must preserve its complete domain payload or fail closed without overwriting that payload.