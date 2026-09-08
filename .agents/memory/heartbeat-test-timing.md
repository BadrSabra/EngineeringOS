---
name: Heartbeat integration test timing
description: Fake-clock stream tests must distinguish timer delivery from asynchronous database heartbeat completion.
---

Use `advanceTimersByTime` for the heartbeat interval and await the mocked heartbeat promise before reading the execution row. Avoid `runOnlyPendingTimersAsync` for this path because it can drain unrelated execution-ledger deadlines and make a short heartbeat fixture appear to run past its model budget.

**Why:** The stream owns both a heartbeat interval and a request execution ledger; draining all pending timers can advance the ledger beyond its deadline while the provider fixture is intentionally blocked.

**How to apply:** Keep long-provider tests on a CHAT fixture, advance exactly one heartbeat interval, await the heartbeat write, and wait for interval cleanup before asserting terminal state after a client disconnect.