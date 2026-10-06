---
name: Shadow replay attempt ownership
description: Concurrent direct starts and durable dispatch must share an attempt lease, including workspace cleanup.
---

A replay row's live lease is the authority for work on its disposable workspace and receipt. Direct request starts and periodic job reconciliation may race; atomically claim queued or expired-running rows with a unique worker identity, then fence lease renewals, cleanup, receipt projection, and terminal transitions by user, attempt, worker, running status, and unexpired lease. A completed recipe execution is not sufficient to complete replay recovery without a matching replay receipt.

**Why:** The recipe execution can complete before Shadow Replay validates proof and persists its receipt. An unfenced reconciler can mistake that interim state for completion and delete the workspace while paired validation still needs it. Recovery also revalidates the source candidate before receipt recovery, so a receipt-only fixture fails closed before it exercises lease handoff.

**How to apply:** Keep replay-row ownership distinct from execution ownership. Build crash-resume fixtures with a current proof-carrying source candidate; test duplicate invocation during recovery, and run integration tests against the currently built API dispatcher when they share its durable database.