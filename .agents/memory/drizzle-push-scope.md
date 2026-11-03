---
name: Drizzle push scope
description: Safely isolate a Drizzle push when the full local schema has unrelated drift.
---

For an isolated Drizzle push, constrain both the local schema and database introspection. In this workspace, `tablesFilter` alone narrowed introspection but left the entire local schema active, causing unrelated tables to appear as new. A schema containing only the target table also made existing enums appear removable; include the shared enum definitions required to preserve the database types. Always run a strict preview and proceed only when the generated SQL contains exactly the reviewed additive change.

**Why:** Development schema review exposed unrelated constraint churn and enum-drop plans. A target-table schema plus the project's enum definitions and a matching table filter produced a preview containing only the intended `CREATE TABLE`; no force flag or hand-written DDL was needed.

**How to apply:** When full `drizzle-kit push` includes unrelated changes, inspect how the installed Drizzle Kit version applies its filters, create a temporary schema scope containing the target table and shared types, and use a strict preview before any write. Remove temporary scope files after the operation.
