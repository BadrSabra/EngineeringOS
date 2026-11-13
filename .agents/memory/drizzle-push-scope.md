---
name: Drizzle push scope
description: Safely isolate a Drizzle push when the full local schema has unrelated drift.
---

For an isolated Drizzle push, constrain both the local schema and database introspection. In this workspace, `tablesFilter` alone narrowed introspection but left the entire local schema active, causing unrelated tables to appear as new. A schema containing only the target table also made existing enums appear removable; include the shared enum definitions required to preserve the database types. Always run a strict preview and proceed only when the generated SQL contains exactly the reviewed additive change.

Replit post-merge scripts run with stdin closed, so an interactive schema push fails. If the established development flow uses `push-force`, require a read-only guard for any flagged existing key/constraint and run the full schema contract check afterward. Never use an unguarded force push or apply it to production.

Drizzle Kit 0.31.10 can still stop a fully scoped Preview push at an interactive enum-resolution prompt before printing SQL. Do not treat that failure as a clean preview and do not add `--force`; after verifying the live target objects are absent, an explicitly approved static additive transaction may be used, followed by the full schema contract check.

Drizzle Kit 0.31.10 may also report `No changes detected` when only the body of an existing named CHECK constraint changes. PostgreSQL CHECK constraints accept `NULL` results, so nullable digest/size predicates need explicit `IS NOT NULL`; otherwise incomplete local Artifact metadata can pass. Keep named CHECK definitions in the application schema contract and, after a reviewed target-only preview, update a changed body with one approved transaction, then run the read-only schema contract check.

For scoped foreign keys, include the referenced existing table in both the exported schema and `tablesFilter`; otherwise Drizzle may propose recreating it. Keep the filter limited to the actual target and referenced table. Give foreign keys explicit names under PostgreSQL's 63-byte identifier limit; an automatically truncated name may be dropped and recreated on every push. When strengthening an existing CHECK, add a separately named constraint rather than relying on a same-name body edit; add the new check to the application schema contract.

**Why:** Development schema review exposed unrelated constraint churn and enum-drop plans; closed stdin blocked interactive pushes. A target-table schema plus required enum definitions and matching table filters produced a safe scope. Further review found FK dependencies are also subject to filtering, PostgreSQL truncates long generated names, and Drizzle may miss changed CHECK bodies; each can cause false table creation, repeated churn, or a missing fail-closed invariant.

**How to apply:** For isolated changes, inspect how the installed Drizzle Kit version applies filters, include referenced tables and enums while keeping `tablesFilter` narrow, and review the generated SQL. If a prompt prevents application, query target objects and affected-row counts read-only, then use only a previously authorized guarded development push; verify stable FK names, CHECK definitions, and the full application schema contract afterward. Preserve checked-in scope files; remove only files created solely for a one-off operation.
