---
name: OpenAPI Zod compatibility
description: Compatibility constraint when adding OpenAPI formats to this workspace's generated Zod client.
---

OpenAPI fields with `format: uuid` or `format: uri` can generate `zod.uuid()` or `zod.url()`, which are unavailable in the workspace's Zod 3 runtime.

**Why:** Orval can complete generation successfully while the generated Zod package fails typechecking afterward.

**How to apply:** Prefer `type: string` for values validated by the server unless the generator/runtime compatibility has been explicitly upgraded and verified. Server-owned URI-like response fields can document their constraints without emitting an unsupported format.