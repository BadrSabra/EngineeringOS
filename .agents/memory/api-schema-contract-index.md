---
name: API schema contracts
description: Grouped pointers for generated schema compatibility and strict API boundary validation.
---

- [OpenAPI Zod compatibility](openapi-zod-compatibility.md)
- [OpenAPI additional-property enforcement](openapi-additional-properties.md)

**Why:** Schema generation can produce runtime incompatibilities or accept undeclared fields if either layer is checked alone.

**How to apply:** Consult both notes when changing generated Zod schemas or API request validation.
