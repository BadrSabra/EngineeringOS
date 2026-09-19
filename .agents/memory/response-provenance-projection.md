---
name: Response provenance projection
description: How public AI response-source provenance stays consistent across live, SSE, persistence, and history.
---

Public provider-versus-fallback provenance must be derived from a server-owned, redacted trace and projected identically into JSON, SSE, persisted messages, and history. The provider's raw output is not an authority for this metadata.

**Why:** Live orchestrator state is unavailable after reload, while persisted traces remain the durable cross-surface boundary. Keeping only an allowlisted source and fallback reason avoids exposing provider diagnostics.

**How to apply:** When adding a new response provenance field, add it to the OpenAPI contract, append only its bounded trace details at persistence time, and parse that trace for historical projections. Keep evidence acceptance independent from the provenance choice.