---
name: Drizzle push scope
description: Safely isolate a Drizzle push when the full local schema has unrelated drift.
---

For an isolated Drizzle push, constrain both the local schema and database introspection. In this workspace, `tablesFilter` alone narrowed introspection but left the entire local schema active, causing unrelated tables to appear as new. A schema containing only the target table also made existing enums appear removable; include the shared enum definitions required to preserve the database types. Always run a strict preview and proceed only when the generated SQL contains exactly the reviewed additive change.

Replit post-merge scripts run with stdin closed, so an interactive schema push fails. If the established development flow uses `push-force`, require a read-only guard for any flagged existing key/constraint and run the full schema contract check afterward. Never use an unguarded force push or apply it to production.

**Why:** Development schema review exposed unrelated constraint churn and enum-drop plans; a later post-merge run also showed that closed stdin turns Drizzle's destructive-change prompt into a failed setup. A target-table schema plus the project's enum definitions and a matching table filter produced a preview containing only the intended `CREATE TABLE`.

**How to apply:** For isolated changes, inspect how the installed Drizzle Kit version applies filters, constrain both schema and introspection, and review a strict preview. For automated development post-merge only, use force only behind a read-only guard for the flagged existing key/constraint, then verify the complete schema contract. Remove temporary scope files after an isolated push.
