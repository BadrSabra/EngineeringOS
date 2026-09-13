---
name: Workspace runtime boundary
description: Runtime ownership rules for project previews versus Replit-managed artifact workflows.
---

The application runtime may supervise explicitly profiled processes owned by a user project, but it must not replace, duplicate, or claim control over Replit-managed artifact workflows.

**Why:** The API process cannot safely restart the process that owns it, and artifact workflows receive platform-managed routing and lifecycle configuration that an application-level replacement would not preserve.

**How to apply:** Keep project runtime controls server-owned and bounded; use a separate supervisor for durable multi-service ownership, while treating EngineeringOS artifact workflows as external platform-owned services.