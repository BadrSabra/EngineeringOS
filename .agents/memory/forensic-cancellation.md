---
name: Forensic cancellation
description: Cancelled forensic runs must preserve evidence while remaining incomplete.
---

Cancellation is a terminal audit state, not a provider timeout or a completed
negative assessment. Retain any evidence already collected and render the
standard six-section report with `ANALYSIS_INCOMPLETE`; never allow cancellation
to select a `NO_VERIFIED_FINDING` fallback or continue recovery.

**Why:** An interrupted audit can otherwise present a false assurance that no
Finding exists, especially when cancellation occurs after some reads or during
Recovery.

**How to apply:** Propagate the AbortSignal through tool gathering, synthesis,
Recovery, and SSE finalization. Keep cancellation diagnostics internal and expose
only sanitized report/terminal metadata.