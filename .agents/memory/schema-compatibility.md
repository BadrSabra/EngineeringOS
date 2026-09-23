---
name: Existing schema type compatibility
description: Drizzle push cannot always cast an established PostgreSQL column type automatically during additive schema work.
---

When extending an existing schema, preserve an established column type unless the change includes an explicit, reviewed migration strategy. Drizzle push may fail on an automatic text-to-numeric cast even when the values look numeric.

**Why:** The development database already contained the strategy confidence column as text, and the schema push refused the type change because PostgreSQL required an explicit `USING` cast.

**How to apply:** Treat additive tables, columns, enums, indexes, and foreign keys as the safe P1 default. Defer type conversions until the project has an explicit migration path and data validation plan.