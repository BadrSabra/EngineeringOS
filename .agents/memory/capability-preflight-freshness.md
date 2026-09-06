---
name: Capability preflight freshness
description: Fresh provider lifecycle validation required before live Capability Probe execution.
---

Capability Probe provider selection must bypass a still-valid lifecycle TTL snapshot and perform an explicit live refresh plus a bounded real tool/structured-output health probe; ordinary chat should continue to use the cached snapshot.

**Why:** A generic lifecycle check can intentionally return the cached snapshot while its TTL is valid, and even a fresh catalog/model check does not prove current quota or completion health. After a provider quota, rate-limit, authentication, or model failure, metadata alone can let a later probe start work against a provider that is no longer usable.

**How to apply:** Add a force-refresh option at the lifecycle boundary, enable it only for Capability Probe selection and explicit fallback refreshes, then run the bounded provider health probe before source reads. Keep normal chat/catalog selection cache-backed and preserve both preflight and execution outcomes in telemetry.