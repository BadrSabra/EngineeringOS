---
name: Dashboard proof fixture contracts
description: Durable rule for browser fixtures that exercise proof-bearing AI executions across resume and reload.
---

Proof-bearing resumable dashboard fixtures must keep `proofRequired` true in the terminal execution state when the user-visible contract still includes persisted proof, even after the execution becomes completed and non-resumable.

**Why:** The dashboard decides whether to render the persisted proof panel from the durable execution status after reload. If a fixture mutates only status/evidence and silently clears `proofRequired`, the product behavior is internally consistent but the browser contract loses the proof panel and masks the lifecycle being tested.

**How to apply:** When building or changing Capability Probe, forensic, or other proof-bearing resume fixtures, assert the terminal status, evidence verdict, and proof-required flag together in both the API fixture and the post-reload dashboard journey.