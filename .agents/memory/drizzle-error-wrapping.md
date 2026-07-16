---
name: Drizzle-orm wraps raw Postgres errors
description: How to detect a specific Postgres error code/constraint (e.g. unique violation) when using drizzle-orm's node-postgres driver.
---

`drizzle-orm`'s node-postgres driver does not throw the raw `pg` error directly — it wraps it in a
`DrizzleQueryError`. The original node-postgres error (with the fields you actually want: `.code`,
e.g. `"23505"` for unique violation, and `.constraint`, the constraint name) lives on `err.cause`, not
on `err` itself.

**Why:** discovered while trying to catch a unique-constraint violation inside a `db.transaction(...)`
block and map it to a specific HTTP response — checking `err.code`/`err.constraint` directly always
missed, because those fields were one level down on `err.cause`.

**How to apply:** when you need to branch on a specific Postgres error inside a catch block around
drizzle calls, check `(err as any)?.cause?.code` and `(err as any)?.cause?.constraint` (falling back to
checking `err` itself too, in case the driver/version wraps differently) rather than assuming the
error object itself carries those fields. Write a small helper (`isUniqueViolation(err, constraintName)`)
rather than inlining this check at every call site.
