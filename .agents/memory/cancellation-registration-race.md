---
name: Cancellation registration race
description: Durable cancellation may arrive between execution claim and in-memory controller registration.
---

An execution worker must re-read its durable row immediately after registering the in-memory abort controller. If cancellation already changed the row to `cancelling`, abort the newly registered controller before entering provider work.

**Why:** The cancel endpoint can successfully update a running execution before the stream has finished setting up its provider call. Checking only the worker's stale pre-registration row leaves a provider waiting forever on a signal that was never aborted.

**How to apply:** Keep durable cancellation authoritative during stream startup; register the controller, reload the owner-scoped execution, and abort when either the row is cancelling or a cancellation timestamp is present.