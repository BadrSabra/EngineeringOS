---
name: Benchmark behavior gates
description: Provider-free benchmark validation must execute each retained fixture oracle, not only verify that an oracle is registered.
---

Release benchmark coverage is incomplete when it checks only fixture metadata or function presence. Every manifest scenario should run its semantic oracle against a server-owned passing candidate in an isolated temporary root before provider work begins.

**Why:** Contract-only checks can remain green while a fixture's behavior or oracle semantics regress, hiding failures until an external provider campaign.

**How to apply:** Keep focused candidates outside provider input and scoring paths; report failures with the scenario ID and preserve benchmark scorecard behavior.