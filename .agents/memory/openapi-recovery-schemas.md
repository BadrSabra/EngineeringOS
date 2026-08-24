---
name: OpenAPI recovery schemas
description: Prevent generated Zod export collisions when adding operation request bodies.
---

New OpenAPI request contracts should use a named component schema and a `$ref`, rather than an inline request body, when the operation generates a similarly named Zod body constant.

**Why:** The workspace exports both generated Zod schemas and generated TypeScript schema types. Orval can emit the same symbol from an inline operation body and the generated types barrel, causing the library typecheck to fail.

**How to apply:** Add the request shape under `components.schemas`, reference it from the operation, regenerate all clients, and run the dashboard client contract check.