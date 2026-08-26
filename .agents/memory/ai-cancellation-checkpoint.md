---
name: AI cancellation checkpoint handling
description: Expected checkpoint lease rejection during user cancellation must not become a stream failure.
---

When a user cancellation wins the execution lease race, late checkpoint writes are expected to be rejected; preserve the incomplete report and terminal cancellation instead of treating those writes as a 500.

**Why:** Cancellation deliberately changes the durable execution state before the provider returns, so final checkpoint persistence can no longer satisfy the normal running-worker fence.

**How to apply:** Gate checkpoint-failure escalation on the abort signal and finalize cancelled executions through the cancellation path, while keeping non-cancelled checkpoint failures blocking.