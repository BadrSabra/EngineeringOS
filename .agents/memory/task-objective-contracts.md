---
name: Task objective contracts
description: Server-owned acceptance contracts for task-specific objectives, validators, evidence, and unsupported outcome boundaries.
---

Every proof-required execution must carry a versioned, hashed task objective contract with a task kind, immutable workspace revision, target scope, required evidence, success criteria, and validator IDs. The contract is persisted in the execution request and checkpoint operation, then projected through durable acceptance and terminal SSE state.

**Why:** Provider success, non-empty output, and a successful build do not prove the requested objective. Deployment, integration, database, conversion, and media outcomes are especially unsafe to infer from narrative responses.

**How to apply:** Add new task kinds through the server-owned contract registry. Reuse existing evidence/validation gates where available; if a real server-owned validator is not registered, keep the terminal result incomplete with an explicit unavailable-validator state rather than accepting it.