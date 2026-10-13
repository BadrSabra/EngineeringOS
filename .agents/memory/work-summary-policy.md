---
name: Home work summary proof policy
description: Why the goal-first home overview samples recorded state instead of revalidating engineering acceptance during polling.
---

Keep the home overview a bounded, advisory inventory. Recorded completion must
not be presented as freshly verified delivery; a sampled view is not a total.

**Why:** The goal-first Arabic experience must explain what needs attention
without making regular home-page reads run expensive proof loaders, recovery,
or approval checks that belong in the item's details.

**How to apply:** If later enriching this overview with verification, use the
existing server-owned acceptance/proof gates and explicitly state freshness
and scope. Never promote sampled statuses or plan membership into proof or
mutation authority. Preserve independent review coverage under heavy activity.

For repeatable-read snapshots, execute queries serially on their shared
connection. PostgreSQL client pg 8.22 warns about concurrently queued
client.query calls and announces their removal in pg 9.

**Why:** Promise.all inside one Drizzle transaction does not provide independent
database connections and produced a real deprecation warning during validation.

**How to apply:** Parallel reads on independent pool connections are different;
do not replace a coherent snapshot with those merely to suppress this warning.
