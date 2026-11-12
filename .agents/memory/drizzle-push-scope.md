---
name: Drizzle push scope
description: Safely isolate a Drizzle push when the full local schema has unrelated drift.
---

For an isolated Drizzle push, constrain both the local schema and database introspection. In this workspace, `tablesFilter` alone narrowed introspection but left the entire local schema active, causing unrelated tables to appear as new. A schema containing only the target table also made existing enums appear removable; include the shared enum definitions required to preserve the database types. Always run a strict preview and proceed only when the generated SQL contains exactly the reviewed additive change.

Replit post-merge scripts run with stdin closed, so an interactive schema push fails. If the established development flow uses `push-force`, require a read-only guard for any flagged existing key/constraint and run the full schema contract check afterward. Never use an unguarded force push or apply it to production.

Drizzle Kit 0.31.10 can still stop a fully scoped Preview push at an interactive enum-resolution prompt before printing SQL. Do not treat that failure as a clean preview and do not add `--force`; after verifying the live target objects are absent, an explicitly approved static additive transaction may be used, followed by the full schema contract check.

Drizzle Kit 0.31.10 may also report `No changes detected` when only the body of an existing named CHECK constraint changes. PostgreSQL CHECK constraints accept `NULL` results, so nullable digest/size predicates need explicit `IS NOT NULL`; otherwise incomplete local Artifact metadata can pass. Keep named CHECK definitions in the application schema contract and, after a reviewed target-only preview, update a changed body with one approved transaction, then run the read-only schema contract check.

**Why:** Development schema review exposed unrelated constraint churn and enum-drop plans; a later post-merge run also showed that closed stdin turns a Drizzle destructive-change prompt into a failed setup. A target-table schema plus the project's enum definitions and a matching table filter produced a preview containing only the intended additive changes. A changed CHECK body was invisible to the same-name diff even though it tightened an important fail-closed invariant.

**How to apply:** For isolated changes, inspect how the installed Drizzle Kit version applies filters, constrain both schema and introspection, and review a strict preview. If the scoped preview stops before SQL, query the target objects read-only and use only a reviewed transaction after explicit authorization. For automated development post-merge only, use force only behind a read-only guard for the flagged existing key/constraint, then verify the complete schema contract. Preserve checked-in scope files; remove only files created solely for a one-off operation.
