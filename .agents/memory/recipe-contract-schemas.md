---
name: Recipe contract schemas
description: Non-obvious Zod and namespaced-ID constraints for safe capability recipe contracts.
---

Required recipe values must use an explicit presence guard rather than relying on `z.any()` or `z.unknown()`; in this Zod runtime those schemas can make object fields optional. Compiled evidence predicates need a separate schema with the wider server-owned node-ID bound because namespacing a valid source ID can exceed the source recipe limit.

**Why:** A missing model value could otherwise pass contract parsing, and validating compiled IDs with the source-node schema can reject valid deterministic plans.

**How to apply:** When adding mandatory recipe fields, use a required value schema. When compiling or persisting namespaced predicates, validate them with the compiled predicate schema rather than the source predicate schema.