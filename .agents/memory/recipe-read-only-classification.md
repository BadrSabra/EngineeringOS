---
name: Read-only invocation telemetry
description: Safety rules for classifying read-only recipe and provider tool invocation events.
---

Read-only invocation telemetry must use explicit server-owned allowlists. Eligibility depends on execution behavior and output/evidence semantics; never infer it from `mutatesProject: false` alone. Recipe read telemetry uses one canonical Episode per execution attempt: persist `OBSERVATION_REQUESTED` before invoking the reader, and block the read if that write fails. Persist `OBSERVATION_RECORDED` before forwarding its result; if that write fails, discard the result and block downstream execution. Episode closure is observational and does not create an Action, Effect, or acceptance proof. Recipe capabilities and provider tool calls are separate invocation surfaces, but both remain observational and cannot replace Action/Effect or acceptance proof.

For file-reading recipe capabilities, Episode telemetry stores only a coarse file-scope descriptor and hashes of the full scope, input, and path-bearing node identity. Never persist the raw path or file content in invocation events.

Provider tool telemetry must run only after registry and authorization checks, and must carry a fingerprint of the full server-authorized provider manifest separately from any narrowed per-turn tool list. Bind events to a durable server-owned Episode; a best-effort shadow Episode without a retained identity is not an audit anchor.

**Why:** A capability can avoid direct project writes while still executing commands or validators, and a successful adapter call does not necessarily produce the verified receipt required by recipe acceptance. Best-effort shadow Episodes can lose invocation identity, and returning data after a failed result write breaks the audit boundary. File paths and node IDs can reveal repository structure. Provider calls may be denied by a narrowed dispatch policy even when their names exist in the full manifest; pre-authorization telemetry would incorrectly record denied calls.

**How to apply:** Inspect the registered adapter, supported scopes, execution paths, output schema, and evidence semantics before adding a capability. Keep invocation identities bound to the current canonical Episode/execution/node attempt and hash raw inputs and outputs rather than persisting them. Keep the allowlist explicit; browser, command, and validator capabilities are not read-only merely because they report `mutatesProject: false`. Preserve the separation from Gate-C/candidate validation and from Effect/Acceptance.