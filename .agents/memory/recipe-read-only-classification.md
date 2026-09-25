---
name: Recipe read-only classification
description: Safety rule for deciding which recipe capability invocations may emit read-only Episode telemetry.
---

Read-only recipe invocation telemetry must use an explicit server-owned capability allowlist. Eligibility depends on both execution behavior and the output/evidence contract; never infer it from `mutatesProject: false` alone. Invocation events remain observational and cannot replace Action/Effect or acceptance proof.

**Why:** A capability can avoid direct project writes while still executing commands or validators, and a successful adapter call does not necessarily produce the verified receipt required by recipe acceptance.

**How to apply:** Inspect the registered adapter, supported scopes, execution paths, output schema, and evidence semantics before adding a capability. Keep invocation identities bound to the current Episode/execution/node attempt and hash raw inputs rather than persisting them.