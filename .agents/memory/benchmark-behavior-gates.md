---
name: Benchmark behavior gates
description: Provider-free benchmark validation must execute each retained fixture oracle, not only verify that an oracle is registered.
---

Release benchmark coverage is incomplete when it checks only fixture metadata or function presence. Every manifest scenario should run its semantic oracle against a server-owned passing candidate in an isolated temporary root before provider work begins.

**Why:** Contract-only checks can remain green while a fixture's behavior or oracle semantics regress, hiding failures until an external provider campaign.

**How to apply:** Keep focused candidates outside provider input and scoring paths; report failures with the scenario ID and preserve benchmark scorecard behavior.

Benchmark rollout proof must retain a candidate-bytes hash on every observation and reject missing or inconsistent hashes at the scorecard gate; this integrity check must not change the A–U grade semantics.

**Why:** A valid oracle result can otherwise be replayed after the candidate workspace changes, making the scorecard evidence refer to a different artifact than the one being promoted.

**How to apply:** Carry the hash through telemetry, replay/persistence envelopes, and scorecard construction; use the scorecard blocker for integrity failures while preserving the original observation grade.

The benchmark API boundary must derive that hash from the isolated workspace itself; caller-provided environment values and persisted observations are untrusted inputs and must be rejected before oracle execution or release comparison.

**Why:** A correct score can otherwise be attached to a stale or substituted candidate while still satisfying the observation-level consistency check.

**How to apply:** Compute once before providers/oracles run, pass the server-owned value into telemetry, and fail closed with a bounded diagnostic when persisted or oracle evidence differs.