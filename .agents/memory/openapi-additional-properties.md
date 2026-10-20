---
name: OpenAPI additional-property enforcement
description: Keep strict OpenAPI request-object contracts enforced by runtime Zod validation.
---

When a request schema declares `additionalProperties: false`, verify the generated Zod object rejects unknown keys. The current OpenAPI-to-Zod output emits a regular `zod.object`, which strips/accepts extras rather than enforcing the contract; call `.strict()` at the route boundary when strict input is required.

**Why:** a contract test with an extra property reached authorization/lookup and returned 404 instead of failing input validation with 400.

**How to apply:** for new strict request bodies, inspect the generated schema and test an unknown property; do not assume `additionalProperties: false` becomes Zod strictness automatically.
