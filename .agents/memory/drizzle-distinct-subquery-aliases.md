---
name: Drizzle DISTINCT subquery aliases
description: Avoid duplicate output names when wrapping joined PostgreSQL DISTINCT ON selections.
---

When wrapping a joined Drizzle `selectDistinctOn` result as a subquery, give every selected expression a unique SQL alias. Tables joined in the same selection often repeat names such as `id` and `created_at`; PostgreSQL can then reject the generated outer query.

**Why:** The failure appears only when a successful data query executes, so request-validation and type checks do not detect it.

**How to apply:** For joined DISTINCT ON queries that become subqueries, explicitly alias session, message, and timestamp fields before reading the outer selection.
