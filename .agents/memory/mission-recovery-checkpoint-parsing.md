---
name: Mission recovery checkpoint parsing
description: Preserve nested Mission tool-loop manifests when reloading durable execution checkpoints.
---

Parse Mission tool-loop recovery state from the full persisted checkpoint envelope, not from the general `parseAiExecutionCheckpoint` projection. That projection intentionally bounds its human-readable `detail` field, while Mission's serialized tool-loop state and recovery manifest are nested in that field and may exceed the limit. The raw-envelope parser must still validate the wrapper stage, sequence, and timestamp, then let the inner parser validate the complete schema, hashes, and identities. Do not widen the general checkpoint projection just to support Mission recovery.

**Why:** A valid persisted `candidate_ready` manifest was being truncated before Mission recovery parsed it, converting an eligible same-attempt resume into a fail-closed invalid checkpoint.

**How to apply:** When adding recovery data inside a checkpoint detail, follow the raw persisted representation from database read through the domain parser. Keep the ordinary projection bounded, and ensure malformed or mismatched raw state remains non-resumable.