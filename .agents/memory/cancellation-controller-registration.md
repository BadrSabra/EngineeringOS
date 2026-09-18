---
name: Cancellation controller registration
description: Durable cancellation must win even when a worker registers its AbortController after the cancel request.
---

Registering an execution controller is part of the durable cancellation boundary: verify the execution is still running before binding it, then re-check after binding and abort/remove it if the row changed.

**Why:** A cancel request can commit between worker claim and controller registration; an in-memory map alone otherwise lets a late worker continue after the user has stopped the execution.

**How to apply:** Keep controller registration awaited by every execution worker, and test both cancellation-before-registration and cancellation-after-registration paths.