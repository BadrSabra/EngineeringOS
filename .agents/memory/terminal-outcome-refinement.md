---
name: Terminal outcome refinement
description: Preserve one final assistant identity while allowing authoritative semantic outcomes to supersede provisional provider failures
---

A provider failure is provisional when a later bounded recovery pass can still produce a server-owned semantic verdict. Keep the execution's single final-message identity, but let a later semantic or recovery failure replace that provisional row; never let a later provider failure downgrade an already authoritative semantic result.

**Why:** Reconnect and fallback paths can persist a rate-limit row before retained evidence is classified. Treating the reserved row as immutable leaves history and the execution checkpoint disagreeing about the actual terminal result.

**How to apply:** Under the execution-row lock, classify the existing final row before returning it. Refine only provider-coded provisional failures, update the same row and session evidence state, and carry the semantic terminal trace through checkpoint, history, and live projections.

Ordinary `CHAT` turns are terminally non-proof-bearing: they must not create an autonomous acceptance contract, evidence snapshot, or resume capability merely because a durable execution row exists.

**Why:** A provider failure can enter the generic execution finalizer after intent routing has already classified the turn as chat; without this boundary, a greeting becomes a forensic, resumable run.

**How to apply:** Persist the server-owned turn intent in the execution request and use it when finalizing failures, emitting `execution_started`, projecting history, and deciding whether the dashboard may retain an execution proof panel.