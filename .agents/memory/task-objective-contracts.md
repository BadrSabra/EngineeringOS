---
name: Task objective contracts
description: Server-owned acceptance contracts for task-specific objectives, validators, evidence, and unsupported outcome boundaries.
---

Every proof-required execution must carry a versioned, hashed task objective contract with a task kind, immutable workspace revision, target scope, required evidence, success criteria, and validator IDs. The contract is persisted in the execution request and checkpoint operation, then projected through durable acceptance and terminal SSE state.

**Why:** Provider success, non-empty output, and a successful build do not prove the requested objective. Deployment, integration, database, conversion, and media outcomes are especially unsafe to infer from narrative responses.

**How to apply:** Add new task kinds through the server-owned contract registry. Reuse existing evidence/validation gates where available; if a real server-owned validator is not registered, keep the terminal result incomplete with an explicit unavailable-validator state rather than accepting it.

Each registered validator must also emit a server-owned receipt before a proof-required task can reach `PROVEN`. The receipt must bind the validator result to the operation, project, workspace revision, and a non-empty artifact reference; checkpointed receipts are data to revalidate, not independent authority.

**Why:** A validator ID plus a positive evidence verdict can otherwise become an unbound claim during completion or reconnect, especially when the task has multiple possible artifact sources.

**How to apply:** Generate receipts only from authoritative server adapters, pass them through autonomous and chat completion gates, persist them in terminal checkpoints, and reject missing, incomplete, unavailable, stale, or cross-operation receipts.

Workflow orchestration decisions are not task-objective proof; keep their durable routing record separate from phase/deployment/integration acceptance.

**Why:** Choosing the next workflow phase is not evidence that the phase ran successfully, and treating the model's routing response as `PROVEN` creates synthetic acceptance.

**How to apply:** Record orchestration with a non-proof execution and let the phase executor or task-specific receipt adapter own terminal success.