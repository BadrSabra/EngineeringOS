---
name: OpenAPI Zod compatibility
description: Compatibility constraint when adding OpenAPI formats to this workspace's generated Zod client.
---

OpenAPI fields with `format: uuid` can generate `zod.uuid()`, which is unavailable in the workspace's Zod 3 runtime.

**Why:** Code generation succeeds but the referenced package typecheck fails after generated schemas are rebuilt.

**How to apply:** For request identifiers already validated by the server, prefer `type: string` in OpenAPI unless the generator/runtime compatibility has been explicitly upgraded and verified.