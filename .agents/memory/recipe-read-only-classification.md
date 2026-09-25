---
name: Read-only invocation telemetry
description: Safety rules for classifying read-only recipe and provider tool invocation events.
---

Read-only invocation telemetry must use explicit server-owned allowlists. Eligibility depends on execution behavior and output/evidence semantics; never infer it from `mutatesProject: false` alone. Recipe capabilities and provider tool calls are separate invocation surfaces, but both remain observational and cannot replace Action/Effect or acceptance proof.

Provider tool telemetry must run only after registry and authorization checks, and must carry a fingerprint of the full server-authorized provider manifest separately from any narrowed per-turn tool list. Bind events to a durable server-owned Episode; a best-effort shadow Episode without a retained identity is not an audit anchor.

**Why:** A capability can avoid direct project writes while still executing commands or validators, and a successful adapter call does not necessarily produce the verified receipt required by recipe acceptance. Provider calls may be denied by a narrowed dispatch policy even when their names exist in the full manifest; pre-authorization telemetry would incorrectly record denied calls.

**How to apply:** Inspect the registered adapter, supported scopes, execution paths, output schema, and evidence semantics before adding a capability. Keep invocation identities bound to the current Episode/execution/node attempt and hash raw inputs and outputs rather than persisting them. Persist a request before exposing read data and withhold the result if completion telemetry cannot be recorded.