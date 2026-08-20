---
name: Shared package type lag
description: TypeScript consumers can temporarily resolve older declarations for workspace packages during live edits.
---

When a shared workspace type has just changed but a consumer still reports the old shape, keep the runtime contract additive and use a narrow compatibility projection at the consumer boundary until the package graph is rebuilt.

**Why:** The workspace resolves package sources through symlinks, but TypeScript tooling can retain an older declaration graph during development; a harmless additive field should not block the running service.

**How to apply:** Prefer rebuilding the package graph first; if the consumer remains stale, isolate the cast to the newly added optional field rather than weakening the entire object or changing unrelated types.