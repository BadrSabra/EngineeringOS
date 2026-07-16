---
name: Deferred FK vs atomic-claim ordering
description: A real FK constraint on a column used for optimistic "claim" patterns can break the claim if the referenced row doesn't exist yet.
---

Pattern seen: a route did an atomic claim via `UPDATE ... SET target_id = X WHERE status = 'ready'`
(optimistic concurrency, first writer wins) as a standalone statement *before* inserting the row that
`target_id` would eventually reference, in a separate transaction. Adding a straightforward Drizzle
`.references()` FK on that column then makes every claim fail with a live FK violation, since the
referenced row doesn't exist yet at claim time.

**Why:** Postgres checks non-deferred FK constraints immediately per-statement, not at transaction end.

**How to apply:** don't reach for `DEFERRABLE INITIALLY DEFERRED` as the first fix (Drizzle's schema
builder doesn't expose it cleanly, and it doesn't help across separate transactions anyway). Instead,
fold the claim UPDATE into the *same* transaction as the row insert it references, ordered so the
insert happens first. The row lock taken by the claim UPDATE still gives the same concurrency
guarantee (concurrent claims block until commit/rollback, then see 0 rows affected). On failure,
throw a typed error to trigger rollback of both the insert and the claim together — no manual "revert
the claim" cleanup code needed since the whole transaction rolls back atomically.

**Related:** the same interaction happens with a UNIQUE constraint, not just FKs. If the row being
inserted before the claim carries a column that's now UNIQUE (e.g. inserting a "project" row keyed by
a shared `rootPath` before claiming the session that produced it), two concurrent racers both attempt
the insert and the loser hits the unique violation *before* ever reaching the claim's conditional
UPDATE. Don't treat that as an unhandled 500 — catch the specific unique-violation (see
[Drizzle error wrapping](drizzle-error-wrapping.md) for how to detect it) and map it to the same
conflict response the claim-loss path already returns, since semantically it's the same race outcome
detected one step earlier.
