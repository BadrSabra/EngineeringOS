---
name: Dashboard freshness watermarks
description: Cross-session dashboard snapshots use server-owned revisions to reject delayed older responses.
---

Dashboard summaries need a server-owned monotonic watermark assembled from the authenticated data they contain; request arrival time is not a safe freshness signal after reconnects.

**Why:** A delayed response from an earlier read can arrive after a newer refresh and otherwise roll the operator’s visible readiness and recovery state backward.

**How to apply:** Include the watermark in aggregated responses and keep the newest revision visible at the client boundary, comparing only snapshots of the same authenticated query scope.

An item-level maximum update timestamp is not a collection revision: removal of
the newest item can lower it, and an empty collection has no item timestamp.
Do not retain a previous mutable list solely because its item watermark is
higher. Scope snapshots by project and filters; use the query's accepted response
for mutable lists unless the server supplies a real collection revision covering
deletions and empty results.

**Why:** The retained-watermark pattern can silently keep deleted work visible
or show one query's results after switching project or filters, even when the
new request succeeds.

**How to apply:** Verify deletion, empty results, and scope changes alongside
delayed responses. A request arrival timestamp is still not a substitute for a
server-owned collection revision.