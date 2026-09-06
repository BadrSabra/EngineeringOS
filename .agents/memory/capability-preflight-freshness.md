---
name: Capability preflight freshness
description: Fresh provider lifecycle validation required before live Capability Probe execution.
---

Capability Probe provider selection must bypass a still-valid lifecycle TTL snapshot and perform an explicit live refresh; ordinary chat should continue to use the cached snapshot.

**Why:** A generic lifecycle check can intentionally return the cached snapshot while its TTL is valid. After a provider quota, rate-limit, authentication, or model failure, that stale selectable state can let a later probe retry a provider that is no longer usable.

**How to apply:** Add a force-refresh option at the lifecycle boundary, enable it only for Capability Probe selection and explicit fallback refreshes, and keep normal chat/catalog selection cache-backed. Preserve the refreshed result in telemetry so the selected provider and failure reason remain auditable.