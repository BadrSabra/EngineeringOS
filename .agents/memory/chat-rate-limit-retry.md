---
name: Chat rate-limit retry
description: Safe same-execution retries for project chat after provider rate limits.
---

An upstream 429 may offer same-execution retry only when the request carries a server-owned project target/resume contract and the provider supplied a positive `Retry-After`. Keep the execution failed and unaccepted; mint a retry capability only after the durable retry deadline. Do not expose the same-execution retry action for generic unscoped project questions, and do not invent a delay when the header is absent or zero.

**Why:** The retry capability is bound to an immutable execution scope and is distinct from proof acceptance. Generic project questions do not have that continuation contract, while retrying before the provider deadline can repeat a shared-pool failure.

**How to apply:** Preserve `retryAt` in the terminal acceptance, enforce it in the server capability endpoint, and project only safe target-mode metadata to the chat UI. Never use 429 as evidence or as permission to mutate a repository.
